/**
 * Smoke tests for `McpClient` using a mocked fetch. Covers the handshake,
 * paginated tools/list, a single tool/call round-trip, and JSON error
 * surfacing via `McpError`.
 */

import { describe, expect, it, vi } from 'vitest'

import { McpClient } from '@/client'
import { McpError } from '@/errors'

type MockFetch = ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** A minimal but complete `tools/list` entry. */
function toolEntry(name: string): {
  name: string
  description: string
  inputSchema: Record<string, unknown>
} {
  return { name, description: `${name} tool`, inputSchema: { type: 'object' } }
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
    )

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const out = await client.initialize()
    expect(out.protocolVersion).toBe('2025-06-18')
    expect(client.currentSessionId).toBe('sess_123')

    const init: unknown = fetchMock.mock.calls[0]?.[1]
    const body = typeof init === 'object' && init !== null && 'body' in init ? init.body : undefined
    expect(typeof body).toBe('string')
    expect(JSON.parse(String(body))).toMatchObject({ method: 'initialize' })
  })

  it('paginates tools/list until nextCursor is absent', async () => {
    const fetchMock: MockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            jsonrpc: '2.0',
            id: 1,
            result: { tools: [toolEntry('a'), toolEntry('b')], nextCursor: 'cur1' },
          },
          200,
          { 'Mcp-Session-Id': 'sess' },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { tools: [toolEntry('c')] },
        }),
      )

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const tools = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['a', 'b', 'c'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('calls a tool and returns the MCP envelope', async () => {
    const fetchMock: MockFetch = vi.fn(async () =>
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: '{"data":{"key":"X"}}' }],
          isError: false,
        },
      }),
    )

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const out = await client.callTool('secrets_reveal', {
      org: 'o',
      workspace: 'w',
      environment: 'e',
      key: 'K',
    })
    expect(out.isError).toBe(false)
    expect(out.content[0]?.text).toContain('X')
  })

  it('unwraps JSON-RPC errors into McpError with the server code', async () => {
    const fetchMock: MockFetch = vi.fn(async () =>
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'Daily quota exceeded for secrets_reveal.',
          data: { code: 'MCP_TOOL_QUOTA_EXCEEDED', status: 429, requestId: 'req_test' },
        },
      }),
    )

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(client.callTool('secrets_reveal', {})).rejects.toBeInstanceOf(McpError)
    try {
      await client.callTool('secrets_reveal', {})
    } catch (err) {
      expect((err as McpError).code).toBe('MCP_TOOL_QUOTA_EXCEEDED')
      expect((err as McpError).status).toBe(429)
    }
  })

  it('retries idempotent calls once on a 5xx response', async () => {
    const fetchMock: MockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":"BAD","message":"boom"}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } }))

    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_live_abc',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const tools = await client.listTools()
    expect(tools).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('times out a hung request with REQUEST_TIMEOUT', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_test',
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 20,
      retries: 0,
    })
    await expect(client.listTools()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', status: 504 })
  })

  it('cancels with REQUEST_ABORTED when the caller aborts, without retrying', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_test',
      fetch: fetchMock as unknown as typeof fetch,
      retries: 3,
    })
    const controller = new AbortController()
    const pending = client.listTools({ signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never lets extra headers override Authorization', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
    )
    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'cf_real',
      fetch: fetchMock as unknown as typeof fetch,
      headers: { Authorization: 'Bearer attacker', 'X-Trace': '1' },
    })
    await client.listTools()
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer cf_real')
    expect(headers['X-Trace']).toBe('1')
  })

  it('rejects a tools/list entry without an input schema', async () => {
    const fetchMock: MockFetch = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a', description: 'x' }] } }),
    )
    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'b',
      fetch: fetchMock as unknown as typeof fetch,
    })
    await expect(client.listTools()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 })
  })

  it('rejects a response that is not a JSON-RPC envelope', async () => {
    const fetchMock: MockFetch = vi.fn(async () => jsonResponse({ hello: 'world' }))
    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'b',
      fetch: fetchMock as unknown as typeof fetch,
      retries: 0,
    })
    await expect(client.callTool('x', {})).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
  })

  it('defaults missing prompt arguments to an empty list', async () => {
    const fetchMock: MockFetch = vi.fn(async () =>
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { prompts: [{ name: 'p', description: 'd' }] },
      }),
    )
    const client = new McpClient({
      endpoint: 'https://mcp.example.test/mcp',
      bearer: 'b',
      fetch: fetchMock as unknown as typeof fetch,
    })
    expect(await client.listPrompts()).toEqual([{ name: 'p', description: 'd', arguments: [] }])
  })
})
