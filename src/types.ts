/** Wire types for `@cryptflare/mcp-client` users. */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Quota metadata of a registry tool. Mirrors `ToolQuota` in
 * `@cryptflare/mcp-shared` (private; not a dependency of this package).
 */
export type ToolQuota = {
  /** Plan-tier quota key (e.g. `secretsReveal`). Unset means no plan cap. */
  planKey?: string
  /** Per-token per-hour ceiling applied regardless of plan tier. */
  perTokenPerHour?: number
}

/** Deprecation metadata. Same keys as the server's `tools/list` `deprecated` object. */
export type ToolDeprecation = {
  /** ISO 8601 date the tool was flagged as deprecated. */
  since: string
  /** snake_case name of the replacement tool, if there is one. */
  replacement?: string
  /** ISO 8601 date after which the tool is removed. Omit if open-ended. */
  removeAfter?: string
  /** Short note explaining the deprecation. */
  reason?: string
}

/**
 * Serialisable view of a registry tool descriptor (everything except the
 * Zod `input` schema and the `resolve` function). Field names match
 * `Tool` in `@cryptflare/mcp-shared`. What `tools/list` actually returns
 * is {@link ToolListEntry}.
 */
export type Tool = {
  /** snake_case `resource_action` identifier. */
  name: string
  /** Agent-facing description, under 200 chars. */
  description: string
  /** Semver string; bump major for breaking input/output shape changes. */
  version: string
  /** Required permission code on the calling token; null means public. */
  permission: string | null
  /** Registry category used by Code Mode search and docs grouping. */
  category: string
  /** True when the tool returns plaintext secret values. */
  returnsSecrets?: boolean
  /** True for mutating tools; they dry-run unless `confirm: true`. */
  write?: boolean
  /** Quota / rate-limit metadata. */
  quota?: ToolQuota
  /** Marks the tool as deprecated; clients should warn or hide it. */
  deprecated?: ToolDeprecation
}

export type PromptArgument = {
  name: string
  description: string
  required: boolean
}

export type Prompt = {
  /** snake_case or kebab-case identifier shown in `prompts/list`. */
  name: string
  /** Agent-facing summary; mirror the tool description convention. */
  description: string
  /** Declared arguments. Unlisted template variables fall back to empty. */
  arguments?: readonly PromptArgument[]
}

export type Resource = {
  /** `cryptflare://...` URI. Stable identifier shown in `resources/list`. */
  uri: string
  /** Human-facing name for the client picker. */
  name: string
  /** Agent-facing description of what the resource contains. */
  description: string
  /** Optional MIME type for the resource body. */
  mimeType?: string
}

/** MCP tool annotations emitted on every `tools/list` entry. */
export type ToolAnnotations = {
  /** True when the tool never mutates state. */
  readOnlyHint?: boolean
  /** True when the tool may mutate or delete state. */
  destructiveHint?: boolean
  /** False: every CryptFlare tool talks only to the CryptFlare API. */
  openWorldHint?: boolean
}

/** Shape of a `tools/list` entry as returned by the server. */
export type ToolListEntry = {
  name: string
  description: string
  /** JSON Schema of the tool's arguments. */
  inputSchema: Record<string, unknown>
  annotations?: ToolAnnotations
  deprecated?: ToolDeprecation
}

/** JSON problem carried in `content[0].text` when `ToolCallResult.isError` is true. */
export type ToolErrorPayload = {
  error: string
  message: string
  status: number
  requestId?: string
}

/** Minimal shape of a `prompts/list` entry. */
export type PromptListEntry = {
  name: string
  description: string
  arguments: Array<{ name: string; description: string; required: boolean }>
}

/** Minimal shape of a `resources/list` entry. */
export type ResourceListEntry = {
  uri: string
  name: string
  description: string
  mimeType: string
}

/** `tools/call` response envelope. `isError: true` means the tool failed; parse `content[0].text` as {@link ToolErrorPayload}. */
export type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>
  isError: boolean
  _meta?: {
    quota?: { limit: number; remaining: number; resetAt: number; dimension: string }
    deprecation?: {
      deprecated: boolean
      since: string
      replacement?: string
      sunset?: string
      reason?: string
    }
  }
}

/** `initialize` handshake response. */
export type InitializeResult = {
  protocolVersion: string
  serverInfo: { name: string; version: string }
  capabilities: Record<string, unknown>
}
