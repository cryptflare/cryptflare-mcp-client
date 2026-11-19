# @cryptflare/mcp-client

## 0.3.0

### Minor Changes

- 1c560bc: **SDK:** Types and errors now match the API.
  - `SecretSettings`, `SecretVersion` and `WhoAmI` are inferred from the API's own schemas. `auth.getMe()` now returns `AuthMeResponse` (`{ user, organisations }`), which is what `/v1/auth/me` sends.
  - `ERRORS` / `ErrorCode` are generated from the API's registry and include every code it can emit (`POD_NOT_FOUND`, `ACCESS_TOKEN_IP_BLOCKED`, `CONFIRMATION_*`, `IMPORT_*` and the MCP codes were missing).
  - New `RequestAbortedError`: a caller's `AbortSignal` no longer surfaces as `ConnectionError` and is never retried.
  - New `EnvelopeError` for malformed or undecryptable `cfenv:` envelopes; `unseal` checks the envelope shape.
  - A 2xx response that is not JSON (for example a proxy's HTML page) or is malformed JSON now throws `UnknownAPIError` with `code: 'invalid_response'` instead of resolving `undefined`. Plain-text bodies are returned as strings.
  - New `client.request(descriptor, options)` escape hatch for endpoints without a typed method. `client.runner` is deprecated in favour of `client.request` and will be removed in the next major version.
  - Enum fields that were typed `string` now carry their literal unions: SSO `default_role` (`OrgRole`), compliance `framework` / `format` / `sections`, dynamic-secret `provider`, billing `addonType`, and secrets-import `source` / `conflictPolicy`. Code that passed arbitrary strings there will need a valid value.

  **MCP client:** Every request now has a timeout (`timeoutMs`, default 30s) and accepts an `AbortSignal`, client-wide or per call. A timeout rejects with `McpError` code `REQUEST_TIMEOUT`, a caller abort with `REQUEST_ABORTED` (never retried). Extra `headers` can no longer override `Authorization`. The exported types now match what the server sends: `Tool` uses `deprecated` and `category` (was `deprecation`, `endpoint`, `tags`), `ToolListEntry` carries `annotations`, and the new `ToolErrorPayload` describes the JSON inside an `isError: true` tool result, which is how the server now reports tool failures.

  **CLI:** Warnings and notes now go to stderr so piped output only carries data, and exit codes tell failure classes apart: `2` usage, `3` authentication, `4` network, `1` anything else. See "Exit codes" in the README. `cf whoami` and `cf auth status` use the SDK's typed `getMe()` response.

### Patch Changes

- 2c4ab2c: **SDK:** Every resource method now calls the route the API serves, and almost every method returns the type that route declares.
  - 181 methods that returned `Promise<unknown>` now return the response type inferred from the API's own Zod schemas (exported from the package root). Ten still return `unknown`: their routes publish no schema, or they are redirects.
  - Calls that could not have worked are fixed. Where the API needs a field the method did not take, the input changed:
    - `auth.requestOtp`, `verifyOtp`, `verifyTotp`, `cli.checkDeviceCode`, `approveDevice`, `pollToken`, `onboarding.verifyCheckout`, `sso.oidcCallback`, `status.checkUnsubscribe`, `tokens.redeemClaim`, `wellKnown.jwks` and `organisations.checkSlug` now use the API's paths.
    - `tokens.create` now takes and sends `workspaceId` and `environment` (both required by the API).
    - `tokens.createClaimLink` posts to `/tokens/claim-links` and takes `{ name, workspaceId, scopes, environment, expiresInMinutes? }`.
    - `transfers.accept` / `transfers.decline` take `{ token }` and send it; `transfers.pending(options?)` no longer takes an unused input.
    - `integrations`: the AWS/GCP federation and secret-list methods and the seven provider list methods take `integrationId`; `listAwsSecrets` no longer takes `region` and `listGcpSecrets` no longer takes `project` (the API never read them); `registerAzure` takes only the organisation; `githubCallback` takes `installationId: number`, `state` and an optional `setupAction`; `githubInstallUrl` returns the `{ data: { url, state } }` envelope.
    - `rotationPolicies.get` / `create` take `{ workspace, environment, key }`.
    - `tags.create` / `tags.delete` take `{ resourceType, resourceId, tag }`.
    - `billing.confirmSession` sends `sessionId`.
    - `support.uploadAttachment` takes `{ ticketId, file: Blob, filename? }` and uploads multipart form data. Request bodies may now be `FormData`.
    - `organisations.toggleFeature` posts `{ feature, enabled }` to `/features` and is no longer deprecated.
  - `checkSlug`, `getFeatures`, `resendInvitation`, `tokens.toggle` and `serviceTokens.toggle` returned `undefined`; they now return the response body.
  - A missing organisation, workspace or environment slug throws `ConfigurationError` instead of a plain `Error`, and `secrets.revealAll` stopping at its page limit throws `UnknownAPIError` (`code: 'pagination_limit'`), so both can be caught with `instanceof CryptFlareError`.
  - Every public method's JSDoc names the permission (or session) the route requires.
  - **Security fix, breaking in practice:** `auth.verifyTotp` now takes `{ pendingLoginToken, code }`. Pass the `pendingLoginToken` that `auth.verifyOtp` returns when `requiresTotp` is true (single use, valid for 5 minutes). The old `{ userId, code }` call could not be made secure: a user id alone let anyone skip the email code and attack the 6-digit second factor directly, so the API now ignores `userId` and answers such a call with `401 AUTH_TOTP_INVALID`.

  **CLI:**
  - `cf service-token list` showed every token as disabled with blank "last used" and "expires" columns; it now reads the fields the API sends.
  - `cf token create` now sends the workspace and environment the API requires.
  - `cf doctor` reports the token kind and organisation (the email it tried to print is not part of the token identity response).
  - `cf status` no longer shows a "Daily Requests" usage row that was always 0 (the API does not report daily usage there).
  - `cf run` with no command after `--` prints a usage error (exit 2) instead of crashing.
  - `cf config unset <key>` rejects keys that are not settings (exit 2) and lists the valid ones, instead of silently doing nothing.
  - `cf org use` and the update notices read "Pick an organisation" / "New version available".

  **MCP client:** Validate every server response at runtime instead of trusting its shape. A malformed envelope or list entry now rejects with `McpError` code `UPSTREAM_ERROR` (status 502). `listPrompts()` returns `arguments: []` when the server omits them, and `listResources()` defaults a missing `mimeType` to `text/plain`.

## 0.2.1

### Patch Changes

- 9f37e22: Update package manifest and build configurations
  - Update repository URLs in package.json files to use git+https:// format
  - Adjust package exports in mcp-client and sdk/typescript to support modern module resolution (default/types/require)
  - Update tsup configuration to output both esm and cjs formats for better type compatibility

## 0.2.0

### Minor Changes

- 89e66d1: Enhance audit logging with context-aware source tracking

  This commit updates the audit logging mechanism to correctly track the source of the request when processing events.

  Key changes include:
  - Source Tracking: The system now checks for specific headers (e.g., `X-Source-System`) to determine the originating system.
  - Middleware Integration: The middleware responsible for logging has been updated to incorporate this source information into the audit record, making logs more traceable.
  - Robustness: Added checks to ensure the source header is present before attempting to use it, preventing runtime errors.

  This improves the observability and debugging capabilities of the application by providing a clear lineage for every logged event.

### Patch Changes

- Updated dependencies [89e66d1]
- Updated dependencies [88c981b]
- Updated dependencies [d6a28bd]
  - @cryptflare/mcp-shared@0.1.0
