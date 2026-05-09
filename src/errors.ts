/**
 * Mirror of the server-side `McpError` that surfaces the RFC 9457
 * problem shape in a client-friendly class. The MCP worker returns
 * errors inside JSON-RPC envelopes; the client unwraps them into
 * `McpError` instances so callers don't have to re-parse.
 */

export class McpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'McpError';
  }

  /** True for codes that represent a transient upstream issue. */
  get isRetriable(): boolean {
    if (this.code === 'RATE_LIMITED' || this.code === 'MCP_TOOL_QUOTA_EXCEEDED') return false;
    return this.status >= 500;
  }
}
