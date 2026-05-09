# Contributing

Thanks for your interest in CryptFlare. This repository is a **public mirror** of the MCP client source that lives in the private CryptFlare platform monorepo. Releases are produced from the monorepo and synced here.

## What goes where

| Change | Where to PR |
|---|---|
| README, docs, examples | This repo |
| CI workflows scoped to this repo | This repo |
| `SECURITY.md`, `CODEOWNERS`, issue templates | This repo |
| Tool surface, transport, types | Open an issue here, fix lands in monorepo |
| Bug reports, feature requests | Open an issue here |

If you are unsure, open an issue first - we will route it.

## Reporting bugs

Use the **Bug report** issue template. Always include:
- Client version (`npm list @cryptflare/mcp-client`)
- Node version
- MCP host (Claude Desktop, Cursor, Zed, custom)
- Minimal reproduction
- Redacted logs (no tokens, IDs, or secrets)

For security issues, email **security@cryptflare.com**. Do not open a public issue.

## Local development (mirror-only changes)

```bash
git clone https://github.com/cryptflare/cryptflare-mcp-client.git
cd cryptflare-mcp-client
npm install
npm run build
npm test
```

Code is synced from the monorepo on each release - your local edits to `src/` will be overwritten on the next sync. Stick to docs, workflows, and tooling.

## Pull request process

1. Fork the repo and create a feature branch.
2. Run `npm run build && npm test` locally.
3. Open a PR against `main`. The PR template will guide the description.
4. CI runs lint + typecheck + tests. All checks must pass.
5. A maintainer will review. Expect a response within 5 business days.

## Conventional commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add secrets_rotate tool wrapper
fix: parse JSON-RPC errors correctly
docs: document stdio transport
chore(deps): bump @modelcontextprotocol/sdk
```

## Code of conduct

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree your contributions are licensed under [Apache-2.0](LICENSE).
