/**
 * Streamable HTTP MCP client. Auto-detects JSON vs SSE from the server's
 * response. Idempotent calls (`tools/list`, `prompts/list`,
 * `resources/list`) retry once on 5xx with exponential backoff.
 *
 * Every request has a timeout (`timeoutMs`, default 30s) and honours an
 * optional caller `AbortSignal`, so a hung server never hangs the agent.
 *
 * Zero runtime dependencies beyond `fetch`, so the bundle stays tiny in
 * edge / browser deployments. Wire types live in `./types` and mirror what
 * the CryptFlare MCP server actually emits.
 */

import { McpError } from '@/errors'
import type {
  InitializeResult,
  PromptListEntry,
  ResourceListEntry,
  ToolCallResult,
  ToolListEntry,
} from '@/types'
import {
  readEnvelope,
  readHttpErrorBody,
  readInitializeResult,
  readListPage,
  readPromptGetResult,
  readPromptListEntry,
  readResourceListEntry,
  readResourceReadResult,
  readToolCallResult,
  readToolListEntry,
  type JsonRpcResponse,
  type PromptGetResult,
  type ResourceReadResult,
} from '@/wire'

/** Constructor options. Only `endpoint` + `bearer` are required. */
export type McpClientOptions = {
  /** Full URL of the `/mcp` endpoint, e.g. `https://mcp.cryptflare.com/mcp`. */
  endpoint: string
  /** Bearer token or `cf_oauth_...` wrapped access token. */
  bearer: string
  /** Accept header override. Defaults to `application/json`; set to
   *  `text/event-stream` to force SSE responses. */
  accept?: 'application/json' | 'text/event-stream'
  /** Override for `fetch`; defaults to global `fetch`. Useful for tests. */
  fetch?: typeof fetch
  /** Extra headers merged onto every request. Cannot override
   *  `Authorization`, `Mcp-Session-Id` or `Content-Type`. */
  headers?: Record<string, string>
  /** Max number of retry attempts for idempotent calls on 5xx. */
  retries?: number
  /** Per-request timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number
  /** Client-wide cancellation signal. Aborting it cancels every in-flight
   *  and future request with an `McpError` of code `REQUEST_ABORTED`. */
  signal?: AbortSignal
}

/** Per-call options accepted by every public method. */
export type McpCallOptions = {
  /** Cancels this call only. Combined with the client-wide signal. */
  signal?: AbortSignal
  /** Overrides the client's `timeoutMs` for this call. */
  timeoutMs?: number
}

/** Default per-request timeout. */
const DEFAULT_TIMEOUT_MS = 30_000

const IDEMPOTENT_METHODS = new Set([
  'tools/list',
  'prompts/list',
  'resources/list',
  'prompts/get',
  'resources/read',
  'initialize',
  'ping',
])

export class McpClient {
  private readonly endpoint: string
  private readonly bearer: string
  private readonly fetcher: typeof fetch
  private readonly extraHeaders: Record<string, string>
  private readonly accept: string
  private readonly retries: number
  private readonly timeoutMs: number
  private readonly signal: AbortSignal | undefined
  private sessionId: string | null = null
  private nextId = 1

  constructor(opts: McpClientOptions) {
    this.endpoint = opts.endpoint
    this.bearer = opts.bearer
    this.fetcher = opts.fetch ?? fetch.bind(globalThis)
    this.extraHeaders = opts.headers ?? {}
    this.accept = opts.accept ?? 'application/json'
    this.retries = opts.retries ?? 1
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.signal = opts.signal
  }

  /** Returns the active session id (if `initialize` has run). */
  get currentSessionId(): string | null {
    return this.sessionId
  }

  /** Opens a new MCP session and returns the server's handshake reply. */
  async initialize(options?: McpCallOptions): Promise<InitializeResult> {
    return readInitializeResult(await this.rpc('initialize', {}, options))
  }

  /** Paginated `tools/list`. Returns all pages concatenated. */
  async listTools(options?: McpCallOptions): Promise<ToolListEntry[]> {
    return this.listAll('tools/list', 'tools', readToolListEntry, options)
  }

  /** Paginated `prompts/list`. */
  async listPrompts(options?: McpCallOptions): Promise<PromptListEntry[]> {
    return this.listAll('prompts/list', 'prompts', readPromptListEntry, options)
  }

  /** `prompts/get` - returns the server's rendered messages array. */
  async getPrompt(
    name: string,
    args?: Record<string, string>,
    options?: McpCallOptions,
  ): Promise<PromptGetResult> {
    return readPromptGetResult(
      await this.rpc('prompts/get', { name, arguments: args ?? {} }, options),
    )
  }

  /** Paginated `resources/list`. */
  async listResources(options?: McpCallOptions): Promise<ResourceListEntry[]> {
    return this.listAll('resources/list', 'resources', readResourceListEntry, options)
  }

  /** `resources/read` - returns the contents array. */
  async readResource(uri: string, options?: McpCallOptions): Promise<ResourceReadResult> {
    return readResourceReadResult(await this.rpc('resources/read', { uri }, options))
  }

  /**
   * Invokes a tool. Returns the full MCP `ToolCallResult` envelope. Tool
   * failures (permission, validation, quota, upstream errors) resolve with
   * `isError: true` and a JSON problem in `content[0].text`; only protocol
   * faults (unknown tool, transport errors) reject with `McpError`.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: McpCallOptions,
  ): Promise<ToolCallResult> {
    return readToolCallResult(await this.rpc('tools/call', { name, arguments: args }, options))
  }

  /** Terminates the session. Idempotent; safe to call twice. */
  async close(): Promise<void> {
    if (!this.sessionId) return
    try {
      await this.timedFetch({
        method: 'DELETE',
        headers: {
          ...this.extraHeaders,
          Authorization: `Bearer ${this.bearer}`,
          'Mcp-Session-Id': this.sessionId,
        },
      })
    } finally {
      this.sessionId = null
    }
  }

  // --- Internal helpers ---------------------------------------------------

  private async listAll<T>(
    method: string,
    key: 'tools' | 'prompts' | 'resources',
    readItem: (item: unknown) => T,
    options?: McpCallOptions,
  ): Promise<T[]> {
    const out: T[] = []
    let cursor: string | undefined
    while (true) {
      const page = readListPage(
        await this.rpc(method, cursor ? { cursor } : {}, options),
        key,
        readItem,
      )
      out.push(...page.items)
      if (page.nextCursor === undefined) break
      cursor = page.nextCursor
    }
    return out
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    options?: McpCallOptions,
  ): Promise<unknown> {
    const idempotent = IDEMPOTENT_METHODS.has(method)
    let lastError: unknown = null
    // Attempt + retries
    for (let attempt = 0; attempt <= (idempotent ? this.retries : 0); attempt++) {
      try {
        return await this.sendOnce(method, params, options)
      } catch (err) {
        lastError = err
        if (!(err instanceof McpError)) throw err
        if (!idempotent || !err.isRetriable) throw err
        // Exponential backoff: 200ms, 400ms, 800ms... capped at 3s.
        const delay = Math.min(3000, 200 * 2 ** attempt)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    throw lastError instanceof Error ? lastError : new Error('rpc failed')
  }

  /**
   * `fetch` with the client timeout and the caller's signals combined. A
   * timeout surfaces as `REQUEST_TIMEOUT` (retriable); a caller abort as
   * `REQUEST_ABORTED` (never retried).
   */
  private async timedFetch(init: RequestInit, options?: McpCallOptions): Promise<Response> {
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs
    const controller = new AbortController()
    const callerSignals = [this.signal, options?.signal].filter(
      (s): s is AbortSignal => s !== undefined,
    )
    const onCallerAbort = (): void => controller.abort()
    for (const s of callerSignals) {
      if (s.aborted) throw new McpError('REQUEST_ABORTED', 'Request aborted by caller', 0)
      s.addEventListener('abort', onCallerAbort, { once: true })
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      return await this.fetcher(this.endpoint, { ...init, signal: controller.signal })
    } catch (err) {
      if (timedOut)
        throw new McpError('REQUEST_TIMEOUT', `Request timed out after ${timeoutMs}ms`, 504)
      if (controller.signal.aborted)
        throw new McpError('REQUEST_ABORTED', 'Request aborted by caller', 0)
      throw err
    } finally {
      clearTimeout(timer)
      for (const s of callerSignals) s.removeEventListener('abort', onCallerAbort)
    }
  }

  private async sendOnce(
    method: string,
    params: Record<string, unknown>,
    options?: McpCallOptions,
  ): Promise<unknown> {
    const id = this.nextId++
    const body = { jsonrpc: '2.0' as const, id, method, params }
    // Caller headers first so they can never replace auth or framing.
    const headers: Record<string, string> = {
      Accept: this.accept,
      ...this.extraHeaders,
      Authorization: `Bearer ${this.bearer}`,
      'Content-Type': 'application/json',
    }
    if (this.sessionId && method !== 'initialize') {
      headers['Mcp-Session-Id'] = this.sessionId
    }

    const res = await this.timedFetch(
      { method: 'POST', headers, body: JSON.stringify(body) },
      options,
    )

    const sessionHeader = res.headers.get('Mcp-Session-Id')
    if (sessionHeader && !this.sessionId) this.sessionId = sessionHeader

    if (!res.ok) {
      const errBody = readHttpErrorBody(await res.json().catch(() => null))
      throw new McpError(
        errBody.error ?? 'UPSTREAM_ERROR',
        errBody.message ?? res.statusText,
        res.status,
        errBody.requestId,
      )
    }

    const contentType = res.headers.get('Content-Type') ?? ''
    let envelope: JsonRpcResponse
    if (contentType.includes('text/event-stream')) {
      envelope = await parseSseEnvelope(res)
    } else {
      envelope = readEnvelope(await res.json().catch(() => null))
    }

    if (envelope.error) {
      const data = envelope.error.data
      throw new McpError(
        data?.code ?? 'JSON_RPC_ERROR',
        envelope.error.message,
        data?.status ?? 500,
        data?.requestId,
      )
    }
    return envelope.result
  }
}

/**
 * Consumes a text/event-stream body until the terminating `message`
 * event. The MCP server emits `progress` events first, then a single
 * `message` carrying the JSON-RPC envelope, then `done`.
 */
async function parseSseEnvelope(res: Response): Promise<JsonRpcResponse> {
  const reader = res.body?.getReader()
  if (!reader) throw new McpError('UPSTREAM_ERROR', 'SSE body missing', 502)
  const decoder = new TextDecoder()
  let buffer = ''
  let result: JsonRpcResponse | null = null

  while (result === null) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const lines = frame.split('\n')
      let event = 'message'
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) data += (data ? '\n' : '') + line.slice(6)
      }
      if (event === 'message' && data) {
        try {
          const parsed: unknown = JSON.parse(data)
          result = readEnvelope(parsed)
          break
        } catch (err) {
          if (err instanceof McpError) throw err
          throw new McpError('UPSTREAM_ERROR', 'Malformed SSE JSON envelope', 502)
        }
      }
    }
  }
  if (!result)
    throw new McpError('UPSTREAM_ERROR', 'SSE stream closed without a message frame', 502)
  return result
}
