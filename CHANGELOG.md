# @cryptflare/mcp-client

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
