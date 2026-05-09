/**
 * Smoke tests for `McpClient` using a mocked fetch. Covers the handshake,
 * paginated tools/list, a single tool/call round-trip, and JSON error
 * surfacing via `McpError`.
 */

import { describe, expect, it, vi } from 'vitest';

import { McpClient } from './client';
import { McpError } from './errors';

type MockFetch = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('McpClient', () => {
  it('performs an initialize handshake and captures the session id', async () => {
    const fetchMock: MockFetch = vi.fn(async () =>
      jsonResponse(
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2025-06-18',
            serverInfo: { name: 'cryptflare-mcp', version: '1.0.0' },
            capabilities: { tools: { paginated: true } },
          },
        },
        200,
        { 'Mcp-Session-Id': 'sess_123' },
      ),
    );

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await client.initialize();
    expect(out.protocolVersion).toBe('2025-06-18');
    expect(client.currentSessionId).toBe('sess_123');

    const call = fetchMock.mock.calls[0];
    const [, init] = call;
    const parsed = JSON.parse((init as RequestInit).body as string) as { method: string };
    expect(parsed.method).toBe('initialize');
  });

  it('paginates tools/list until nextCursor is absent', async () => {
    const fetchMock: MockFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 1,
        result: { tools: [{ name: 'a' }, { name: 'b' }], nextCursor: 'cur1' },
      }, 200, { 'Mcp-Session-Id': 'sess' }))
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 2,
        result: { tools: [{ name: 'c' }] },
      }));

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['a', 'b', 'c']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('calls a tool and returns the MCP envelope', async () => {
    const fetchMock: MockFetch = vi.fn(async () =>
      jsonResponse({
        jsonrpc: '2.0', id: 1,
        result: {
          content: [{ type: 'text', text: '{"data":{"key":"X"}}' }],
          isError: false,
        },
      }),
    );

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await client.callTool('secrets_reveal', { org: 'o', workspace: 'w', environment: 'e', key: 'K' });
    expect(out.isError).toBe(false);
    expect(out.content[0].text).toContain('X');
  });

  it('unwraps JSON-RPC errors into McpError with the server code', async () => {
    const fetchMock: MockFetch = vi.fn(async () =>
      jsonResponse({
        jsonrpc: '2.0', id: 1,
        error: {
          code: -32000,
          message: 'Daily quota exceeded for secrets_reveal.',
          data: { code: 'MCP_TOOL_QUOTA_EXCEEDED', status: 429, requestId: 'req_test' },
        },
      }),
    );

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.callTool('secrets_reveal', {})).rejects.toBeInstanceOf(McpError);
    try {
      await client.callTool('secrets_reveal', {});
    } catch (err) {
      expect((err as McpError).code).toBe('MCP_TOOL_QUOTA_EXCEEDED');
      expect((err as McpError).status).toBe(429);
    }
  });

  it('retries idempotent calls once on a 5xx response', async () => {
    const fetchMock: MockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"BAD","message":"boom"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } }));

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const tools = await client.listTools();
    expect(tools).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
