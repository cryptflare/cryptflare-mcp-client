/** Public barrel for `@cryptflare/mcp-client`. */

export { McpClient } from './client'
export type { McpCallOptions, McpClientOptions } from './client'
export { McpError } from './errors'
export type {
  InitializeResult,
  PromptListEntry,
  ResourceListEntry,
  ToolAnnotations,
  ToolCallResult,
  ToolErrorPayload,
  ToolListEntry,
} from './types'
export type {
  Tool,
  ToolQuota,
  ToolDeprecation,
  HttpMethod,
  Prompt,
  PromptArgument,
  Resource,
} from './types'
