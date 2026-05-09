/** Public barrel for `@cryptflare/mcp-client`. */

export { McpClient } from './client';
export type { McpClientOptions } from './client';
export { McpError } from './errors';
export type {
  InitializeResult,
  PromptListEntry,
  ResourceListEntry,
  ToolCallResult,
  ToolListEntry,
} from './types';
export type { Tool, ToolQuota, ToolDeprecation, HttpMethod, Prompt, PromptArgument, Resource } from './types';
