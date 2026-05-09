/**
 * Streamable HTTP MCP client. Auto-detects JSON vs SSE from the server's
 * response. Idempotent calls (`tools/list`, `prompts/list`,
 * `resources/list`) retry once on 5xx with exponential backoff.
 *
 * Zero runtime dependencies beyond `fetch` and `@cryptflare/mcp-shared`
 * types so the bundle stays tiny in edge / browser deployments.
 */

import { McpError } from './errors';
import type {
  InitializeResult,
  PromptListEntry,
  ResourceListEntry,
  ToolCallResult,
  ToolListEntry,
} from './types';

/** Constructor options. Only `endpoint` + `bearer` are required. */
export type McpClientOptions = {
  /** Full URL of the `/mcp` endpoint, e.g. `https://mcp.cryptflare.com/mcp`. */
  endpoint: string;
  /** Bearer token or `cf_oauth_...` wrapped access token. */
  bearer: string;
  /** Accept header override. Defaults to `application/json`; set to
   *  `text/event-stream` to force SSE responses. */
  accept?: 'application/json' | 'text/event-stream';
  /** Override for `fetch`; defaults to global `fetch`. Useful for tests. */
  fetch?: typeof fetch;
  /** Extra headers merged onto every request. */
  headers?: Record<string, string>;
  /** Max number of retry attempts for idempotent calls on 5xx. */
  retries?: number;
};

/** JSON-RPC response envelope. */
type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | undefined;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: { code: string; status: number; requestId?: string };
  };
};

const IDEMPOTENT_METHODS = new Set([
  'tools/list',
  'prompts/list',
  'resources/list',
  'prompts/get',
  'resources/read',
  'initialize',
  'ping',
]);

export class McpClient {
  private readonly endpoint: string;
  private readonly bearer: string;
  private readonly fetcher: typeof fetch;
  private readonly extraHeaders: Record<string, string>;
  private readonly accept: string;
  private readonly retries: number;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(opts: McpClientOptions) {
    this.endpoint = opts.endpoint;
    this.bearer = opts.bearer;
    this.fetcher = opts.fetch ?? fetch.bind(globalThis);
    this.extraHeaders = opts.headers ?? {};
    this.accept = opts.accept ?? 'application/json';
    this.retries = opts.retries ?? 1;
  }

  /** Returns the active session id (if `initialize` has run). */
  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /** Opens a new MCP session and returns the server's handshake reply. */
  async initialize(): Promise<InitializeResult> {
    const result = await this.rpc<InitializeResult>('initialize', {});
    return result;
  }

  /** Paginated `tools/list`. Returns all pages concatenated. */
  async listTools(): Promise<ToolListEntry[]> {
    return this.listAll<ToolListEntry>('tools/list', 'tools');
  }

  /** Paginated `prompts/list`. */
  async listPrompts(): Promise<PromptListEntry[]> {
    return this.listAll<PromptListEntry>('prompts/list', 'prompts');
  }

  /** `prompts/get` - returns the server's rendered messages array. */
  async getPrompt(name: string, args?: Record<string, string>): Promise<{ description: string; messages: Array<{ role: string; content: { type: string; text: string } }> }> {
    return this.rpc('prompts/get', { name, arguments: args ?? {} });
  }

  /** Paginated `resources/list`. */
  async listResources(): Promise<ResourceListEntry[]> {
    return this.listAll<ResourceListEntry>('resources/list', 'resources');
  }

  /** `resources/read` - returns the contents array. */
  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    return this.rpc('resources/read', { uri });
  }

  /** Invokes a tool. Returns the full MCP `ToolCallResult` envelope. */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    return this.rpc<ToolCallResult>('tools/call', { name, arguments: args });
  }

  /** Terminates the session. Idempotent; safe to call twice. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.fetcher(this.endpoint, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.bearer}`,
          'Mcp-Session-Id': this.sessionId,
          ...this.extraHeaders,
        },
      });
    } finally {
      this.sessionId = null;
    }
  }

  // --- Internal helpers ---------------------------------------------------

  private async listAll<T>(method: string, key: 'tools' | 'prompts' | 'resources'): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = await this.rpc<{ [k: string]: T[] | string | undefined }>(method, cursor ? { cursor } : {});
      const items = (page[key] as T[] | undefined) ?? [];
      out.push(...items);
      const next = page.nextCursor;
      if (typeof next !== 'string' || next === '') break;
      cursor = next;
    }
    return out;
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const idempotent = IDEMPOTENT_METHODS.has(method);
    let lastError: unknown = null;
    // Attempt + retries
    for (let attempt = 0; attempt <= (idempotent ? this.retries : 0); attempt++) {
      try {
        const response = await this.sendOnce(method, params);
        return response as T;
      } catch (err) {
        lastError = err;
        if (!(err instanceof McpError)) throw err;
        if (!idempotent || !err.isRetriable) throw err;
        // Exponential backoff: 200ms, 400ms, 800ms... capped at 3s.
        const delay = Math.min(3000, 200 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('rpc failed');
  }

  private async sendOnce(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const body = { jsonrpc: '2.0' as const, id, method, params };
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.bearer}`,
      Accept: this.accept,
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.sessionId && method !== 'initialize') {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const res = await this.fetcher(this.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });

    const sessionHeader = res.headers.get('Mcp-Session-Id');
    if (sessionHeader && !this.sessionId) this.sessionId = sessionHeader;

    if (!res.ok) {
      let errBody: { error?: string; message?: string; requestId?: string } | null = null;
      try {
        errBody = (await res.json()) as { error?: string; message?: string; requestId?: string } | null;
      } catch {
        errBody = null;
      }
      throw new McpError(
        errBody?.error ?? 'UPSTREAM_ERROR',
        errBody?.message ?? res.statusText,
        res.status,
        errBody?.requestId,
      );
    }

    const contentType = res.headers.get('Content-Type') ?? '';
    let envelope: JsonRpcResponse;
    if (contentType.includes('text/event-stream')) {
      envelope = await parseSseEnvelope(res);
    } else {
      envelope = (await res.json()) as JsonRpcResponse;
    }

    if (envelope.error) {
      const data = envelope.error.data;
      throw new McpError(
        data?.code ?? 'JSON_RPC_ERROR',
        envelope.error.message,
        data?.status ?? 500,
        data?.requestId,
      );
    }
    return envelope.result;
  }
}

/**
 * Consumes a text/event-stream body until the terminating `message`
 * event. The MCP server emits `progress` events first, then a single
 * `message` carrying the JSON-RPC envelope, then `done`.
 */
async function parseSseEnvelope(res: Response): Promise<JsonRpcResponse> {
  const reader = res.body?.getReader();
  if (!reader) throw new McpError('UPSTREAM_ERROR', 'SSE body missing', 502);
  const decoder = new TextDecoder();
  let buffer = '';
  let result: JsonRpcResponse | null = null;

  while (result === null) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const lines = frame.split('\n');
      let event = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += (data ? '\n' : '') + line.slice(6);
      }
      if (event === 'message' && data) {
        try {
          result = JSON.parse(data) as JsonRpcResponse;
          break;
        } catch {
          throw new McpError('UPSTREAM_ERROR', 'Malformed SSE JSON envelope', 502);
        }
      }
    }
  }
  if (!result) throw new McpError('UPSTREAM_ERROR', 'SSE stream closed without a message frame', 502);
  return result;
}
