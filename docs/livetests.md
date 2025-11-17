# Live MCP Tests

These tests hit real hosted MCP servers and require outbound HTTP. They are **off by default** to keep CI and local runs deterministic.

## When to run
- Before releases when you want end-to-end validation against hosted servers.
- When debugging regressions that only repro against real servers (e.g., DeepWiki).

## How to run
```bash
MCP_LIVE_TESTS=1 pnpm test:live
```

This runs the Vitest suite under `tests/live`, in-band, with longer timeouts.

## Current coverage
- **DeepWiki** (both wire protocols):
  - Streamable HTTP: `https://mcp.deepwiki.com/mcp`
  - SSE: `https://mcp.deepwiki.com/sse`
  - Test: calls `read_wiki_structure repoName:facebook/react` and asserts a non-empty result.

## Notes
- Tests are skipped entirely unless `MCP_LIVE_TESTS=1` is set.
- Ensure network egress is allowed. No secrets are required for the current DeepWiki checks.
- Keep assertions minimal to reduce flake; these are availability smokes, not full contract tests.
