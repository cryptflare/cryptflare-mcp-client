# @cryptflare/mcp-client

[![npm version](https://img.shields.io/npm/v/@cryptflare/mcp-client.svg)](https://www.npmjs.com/package/@cryptflare/mcp-client)
[![npm downloads](https://img.shields.io/npm/dm/@cryptflare/mcp-client.svg)](https://www.npmjs.com/package/@cryptflare/mcp-client)
[![License](https://img.shields.io/npm/l/@cryptflare/mcp-client.svg)](LICENSE)
[![CI](https://github.com/cryptflare/cryptflare-mcp-client/actions/workflows/ci.yml/badge.svg)](https://github.com/cryptflare/cryptflare-mcp-client/actions/workflows/ci.yml)

Typed [Model Context Protocol](https://modelcontextprotocol.io) client for [CryptFlare](https://cryptflare.com). Use CryptFlare tools (secrets, pods, audit, sync, etc.) from MCP-compatible AI agents like **Claude**, **Cursor**, and **Zed**.

> This repository is the **public mirror** of `packages/mcp-client` from the CryptFlare platform monorepo. Source-of-truth lives in the monorepo and is synced here on every release. **Open issues and pull requests in this repository.**

## Features

- Strongly-typed wrappers over the CryptFlare MCP server (`mcp.cryptflare.com`)
- Tool surface generated from the same Zod registry as the server
- Works in Node 20+, edge runtimes, and any environment with `fetch`
- Stdio and HTTP transports
- Provenance-attested builds via [npm sigstore](https://docs.npmjs.com/generating-provenance-statements)

## Install

```bash
npm install @cryptflare/mcp-client
```

## Quick start

```ts
import { createMcpClient } from '@cryptflare/mcp-client';

const mcp = createMcpClient({
  token: process.env.CRYPTFLARE_TOKEN!,
});

const pods = await mcp.pods_list({ workspace_id: 'wsp_...' });

const secrets = await mcp.secrets_list({
  pod_id: pods[0].id,
  environment_id: 'env_production',
});
```

## Use with Claude Desktop / Cursor / Zed

Hosted MCP server: `https://mcp.cryptflare.com`. See https://cryptflare.com/mcp for client-specific configuration.

## Documentation

- **Full reference**: https://cryptflare.com/mcp
- **Tool catalogue**: https://cryptflare.com/mcp/tools
- **Examples**: https://github.com/cryptflare/examples

## Versioning

We follow [Semantic Versioning](https://semver.org/):
- **Major** - breaking tool surface or transport changes
- **Minor** - new tools or non-breaking schema additions
- **Patch** - bug fixes

Pre-1.0 minors may include breaking changes - we will call this out in the changelog.

## Supply chain

Every release is published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). The Verified badge on npm proves the package was built from this exact commit by GitHub Actions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Most code changes are made in the upstream monorepo; doc, README, and tooling fixes can be PR'd here.

## Security

Vulnerabilities: email **security@cryptflare.com**. See [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE) (c) BUUN GROUP PTY LTD
