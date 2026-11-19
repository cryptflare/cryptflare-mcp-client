/**
 * Runtime checks for what the MCP server sends back. The client has no
 * runtime dependencies, so these are small hand-written guards rather than
 * Zod schemas. Each `read*` function either returns a typed value or
 * throws `McpError('UPSTREAM_ERROR', ..., 502)`.
 */

import { McpError } from '@/errors'
import type {
  InitializeResult,
  PromptListEntry,
  ResourceListEntry,
  ToolAnnotations,
  ToolCallResult,
  ToolDeprecation,
  ToolListEntry,
} from '@/types'

/** JSON-RPC response envelope. */
export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id?: string | number | undefined
  result?: unknown
  error?:
    | {
        code: number
        message: string
        data?: { code: string; status: number; requestId?: string | undefined } | undefined
      }
    | undefined
}

/** Error body of a non-2xx HTTP response. */
export type HttpErrorBody = { error?: string; message?: string; requestId?: string }

/** `prompts/get` result. */
export type PromptGetResult = {
  description: string
  messages: Array<{ role: string; content: { type: string; text: string } }>
}

/** `resources/read` result. */
export type ResourceReadResult = {
  contents: Array<{ uri: string; mimeType: string; text: string }>
}

/** True for a plain (non-array, non-null) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function malformed(what: string): McpError {
  return new McpError('UPSTREAM_ERROR', `Malformed ${what} from MCP server`, 502)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Validates a JSON-RPC envelope. */
export function readEnvelope(value: unknown): JsonRpcResponse {
  if (!isRecord(value) || value['jsonrpc'] !== '2.0') throw malformed('JSON-RPC envelope')
  const id = value['id']
  const envelope: JsonRpcResponse = { jsonrpc: '2.0', result: value['result'] }
  if (typeof id === 'string' || typeof id === 'number') envelope.id = id
  const error = value['error']
  if (error !== undefined) {
    if (
      !isRecord(error) ||
      typeof error['code'] !== 'number' ||
      typeof error['message'] !== 'string'
    ) {
      throw malformed('JSON-RPC error')
    }
    const data = error['data']
    envelope.error = {
      code: error['code'],
      message: error['message'],
      data:
        isRecord(data) && typeof data['code'] === 'string' && typeof data['status'] === 'number'
          ? {
              code: data['code'],
              status: data['status'],
              requestId: optionalString(data['requestId']),
            }
          : undefined,
    }
  }
  return envelope
}

/** Reads the `{ error, message, requestId }` body of a failed HTTP call; never throws. */
export function readHttpErrorBody(value: unknown): HttpErrorBody {
  if (!isRecord(value)) return {}
  const body: HttpErrorBody = {}
  const error = optionalString(value['error'])
  const message = optionalString(value['message'])
  const requestId = optionalString(value['requestId'])
  if (error !== undefined) body.error = error
  if (message !== undefined) body.message = message
  if (requestId !== undefined) body.requestId = requestId
  return body
}

export function readInitializeResult(value: unknown): InitializeResult {
  if (!isRecord(value)) throw malformed('initialize result')
  const serverInfo = value['serverInfo']
  const capabilities = value['capabilities']
  if (
    typeof value['protocolVersion'] !== 'string' ||
    !isRecord(serverInfo) ||
    typeof serverInfo['name'] !== 'string' ||
    typeof serverInfo['version'] !== 'string' ||
    !isRecord(capabilities)
  ) {
    throw malformed('initialize result')
  }
  return {
    protocolVersion: value['protocolVersion'],
    serverInfo: { name: serverInfo['name'], version: serverInfo['version'] },
    capabilities,
  }
}

function isTextContent(value: unknown): value is { type: 'text'; text: string } {
  return isRecord(value) && value['type'] === 'text' && typeof value['text'] === 'string'
}

export function readToolCallResult(value: unknown): ToolCallResult {
  if (!isRecord(value)) throw malformed('tools/call result')
  const content = value['content']
  if (
    !Array.isArray(content) ||
    !content.every(isTextContent) ||
    typeof value['isError'] !== 'boolean'
  ) {
    throw malformed('tools/call result')
  }
  const result: ToolCallResult = { content, isError: value['isError'] }
  const meta = value['_meta']
  if (isRecord(meta)) result._meta = readToolMeta(meta)
  return result
}

type ToolMeta = NonNullable<ToolCallResult['_meta']>

function readToolMeta(meta: Record<string, unknown>): ToolMeta {
  const out: ToolMeta = {}
  const quota = meta['quota']
  if (
    isRecord(quota) &&
    typeof quota['limit'] === 'number' &&
    typeof quota['remaining'] === 'number' &&
    typeof quota['resetAt'] === 'number' &&
    typeof quota['dimension'] === 'string'
  ) {
    out.quota = {
      limit: quota['limit'],
      remaining: quota['remaining'],
      resetAt: quota['resetAt'],
      dimension: quota['dimension'],
    }
  }
  const dep = meta['deprecation']
  if (isRecord(dep) && typeof dep['deprecated'] === 'boolean' && typeof dep['since'] === 'string') {
    const deprecation: NonNullable<ToolMeta['deprecation']> = {
      deprecated: dep['deprecated'],
      since: dep['since'],
    }
    const replacement = optionalString(dep['replacement'])
    const sunset = optionalString(dep['sunset'])
    const reason = optionalString(dep['reason'])
    if (replacement !== undefined) deprecation.replacement = replacement
    if (sunset !== undefined) deprecation.sunset = sunset
    if (reason !== undefined) deprecation.reason = reason
    out.deprecation = deprecation
  }
  return out
}

function isPromptMessage(value: unknown): value is PromptGetResult['messages'][number] {
  if (!isRecord(value) || typeof value['role'] !== 'string') return false
  const content = value['content']
  return (
    isRecord(content) && typeof content['type'] === 'string' && typeof content['text'] === 'string'
  )
}

export function readPromptGetResult(value: unknown): PromptGetResult {
  if (!isRecord(value) || typeof value['description'] !== 'string')
    throw malformed('prompts/get result')
  const messages = value['messages']
  if (!Array.isArray(messages) || !messages.every(isPromptMessage))
    throw malformed('prompts/get result')
  return { description: value['description'], messages }
}

function isResourceContent(value: unknown): value is ResourceReadResult['contents'][number] {
  return (
    isRecord(value) &&
    typeof value['uri'] === 'string' &&
    typeof value['mimeType'] === 'string' &&
    typeof value['text'] === 'string'
  )
}

export function readResourceReadResult(value: unknown): ResourceReadResult {
  const contents = isRecord(value) ? value['contents'] : undefined
  if (!Array.isArray(contents) || !contents.every(isResourceContent))
    throw malformed('resources/read result')
  return { contents }
}

/** One page of a paginated list method. */
export type ListPage<T> = { items: T[]; nextCursor: string | undefined }

/** Reads `{ [key]: T[], nextCursor? }`, reading every item with `readItem` (which throws on a bad item). */
export function readListPage<T>(
  value: unknown,
  key: string,
  readItem: (item: unknown) => T,
): ListPage<T> {
  if (!isRecord(value)) throw malformed(`${key} page`)
  const raw = value[key] ?? []
  if (!Array.isArray(raw)) throw malformed(`${key} page`)
  const next = value['nextCursor']
  return {
    items: raw.map(readItem),
    nextCursor: typeof next === 'string' && next !== '' ? next : undefined,
  }
}

export function readToolListEntry(value: unknown): ToolListEntry {
  if (
    !isRecord(value) ||
    typeof value['name'] !== 'string' ||
    typeof value['description'] !== 'string'
  ) {
    throw malformed('tools/list entry')
  }
  const inputSchema = value['inputSchema']
  if (!isRecord(inputSchema)) throw malformed('tools/list entry')
  const entry: ToolListEntry = {
    name: value['name'],
    description: value['description'],
    inputSchema,
  }
  const annotations = value['annotations']
  if (isRecord(annotations)) entry.annotations = readAnnotations(annotations)
  const deprecated = value['deprecated']
  if (isRecord(deprecated) && typeof deprecated['since'] === 'string') {
    const dep: ToolDeprecation = { since: deprecated['since'] }
    const replacement = optionalString(deprecated['replacement'])
    const removeAfter = optionalString(deprecated['removeAfter'])
    const reason = optionalString(deprecated['reason'])
    if (replacement !== undefined) dep.replacement = replacement
    if (removeAfter !== undefined) dep.removeAfter = removeAfter
    if (reason !== undefined) dep.reason = reason
    entry.deprecated = dep
  }
  return entry
}

function readAnnotations(value: Record<string, unknown>): ToolAnnotations {
  const out: ToolAnnotations = {}
  for (const key of ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const) {
    const flag = value[key]
    if (typeof flag === 'boolean') out[key] = flag
  }
  return out
}

function isPromptArgument(value: unknown): value is PromptListEntry['arguments'][number] {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['description'] === 'string' &&
    typeof value['required'] === 'boolean'
  )
}

export function readPromptListEntry(value: unknown): PromptListEntry {
  if (
    !isRecord(value) ||
    typeof value['name'] !== 'string' ||
    typeof value['description'] !== 'string'
  ) {
    throw malformed('prompts/list entry')
  }
  const args = value['arguments'] ?? []
  if (!Array.isArray(args) || !args.every(isPromptArgument)) throw malformed('prompts/list entry')
  return { name: value['name'], description: value['description'], arguments: args }
}

export function readResourceListEntry(value: unknown): ResourceListEntry {
  if (
    !isRecord(value) ||
    typeof value['uri'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    typeof value['description'] !== 'string'
  ) {
    throw malformed('resources/list entry')
  }
  return {
    uri: value['uri'],
    name: value['name'],
    description: value['description'],
    mimeType: optionalString(value['mimeType']) ?? 'text/plain',
  }
}
