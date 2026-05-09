/** Wire types for `@cryptflare/mcp-client` users. */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ToolQuota = {
  /** Plan-tier quota key (e.g. `mcp_calls_per_day`). `null` means unlimited. */
  planKey?: string;
  /** Per-token per-hour ceiling applied regardless of plan tier. */
  perTokenPerHour?: number;
};

export type ToolDeprecation = {
  /** ISO 8601 date the tool was flagged as deprecated. */
  since: string;
  /** snake_case name of the replacement tool, if there is one. */
  replacement?: string;
  /** ISO 8601 date after which the tool is removed. Omit if open-ended. */
  removeAfter?: string;
  /** Short note explaining the deprecation. */
  reason?: string;
};

export type Tool = {
  /** snake_case `resource_action` identifier. */
  name: string;
  /** Agent-facing description, under 200 chars. */
  description: string;
  /** Semver string; bump major for breaking input/output shape changes. */
  version?: string;
  /** Required permission code on the calling token. */
  permission?: string;
  /** REST endpoint the MCP worker delegates to. */
  endpoint?: { method: HttpMethod; path: string };
  /** Quota / rate-limit metadata. */
  quota?: ToolQuota;
  /** Marks the tool as deprecated; clients should warn or hide it. */
  deprecation?: ToolDeprecation;
  /** Free-form tags used by the Code Mode search tool for fuzzy matching. */
  tags?: readonly string[];
};

export type PromptArgument = {
  name: string;
  description: string;
  required: boolean;
};

export type Prompt = {
  /** snake_case or kebab-case identifier shown in `prompts/list`. */
  name: string;
  /** Agent-facing summary; mirror the tool description convention. */
  description: string;
  /** Declared arguments. Unlisted template variables fall back to empty. */
  arguments?: readonly PromptArgument[];
};

export type Resource = {
  /** `cryptflare://...` URI. Stable identifier shown in `resources/list`. */
  uri: string;
  /** Human-facing name for the client picker. */
  name: string;
  /** Agent-facing description of what the resource contains. */
  description: string;
  /** Optional MIME type for the resource body. */
  mimeType?: string;
};

/** Minimal shape of a `tools/list` entry as returned by the server. */
export type ToolListEntry = {
  name: string;
  description: string;
  inputSchema: unknown;
  deprecated?: {
    since: string;
    replacement?: string;
    removeAfter?: string;
    reason?: string;
  };
};

/** Minimal shape of a `prompts/list` entry. */
export type PromptListEntry = {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
};

/** Minimal shape of a `resources/list` entry. */
export type ResourceListEntry = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

/** `tools/call` response envelope. */
export type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
  _meta?: {
    quota?: { limit: number; remaining: number; resetAt: number; dimension: string };
    deprecation?: { deprecated: boolean; since: string; replacement?: string; sunset?: string; reason?: string };
  };
};

/** `initialize` handshake response. */
export type InitializeResult = {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
};
