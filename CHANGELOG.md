# Changelog

## [Unreleased]

- Swapped the `--required-only` / `--include-optional` pair for a single `--all-parameters` flag, updated the CLI hinting copy, and documented the new workflow across README/spec/call-syntax.
- Refined single-server output: doc blocks insert a blank line before `@param`, long sentences wrap to 100 characters, the server summary line prints after the tool details, and color tinting now keeps `function` keywords grey while parameter labels highlight the `@param` and name.
- `Examples:` now shows a single, ellipsized `mcporter call …` entry (unless the call already fits in ~80 characters) so verbose argument lists don't dominate the output.
- Guaranteed that default listings always show at least five parameters (even if every field is optional) before summarising the rest, and added compact summaries (`// optional (N): …`).
- Added `src/cli/list-detail-helpers.ts` plus dedicated unit tests (`tests/list-detail-helpers.test.ts`) covering wrapping, param selection, and optional summaries; introduced an inline snapshot test for a complex Linear server to prevent regressions in the CLI formatter.
- Exported the identifier normalization helpers so other modules can reuse the shared Levenshtein logic without duplicate implementations.

## [0.3.0] - 2025-11-06

- Added configurable log levels (`--log-level` flag and `MCPORTER_LOG_LEVEL`) with a default of `warn`, and promoted transport fallbacks to warnings so important failures still surface at the quieter default.
- Forced the CLI to exit cleanly after shutdown (new `MCPORTER_NO_FORCE_EXIT` opt-out) and patched `StdioClientTransport` locally so stdio MCP servers do not leave Node handles hanging. Documented the tmux workflow for hang debugging.
- Reworked `mcporter list` output: the spinner no longer gets clobbered, summaries print once discovery completes, and stdio server stderr is buffered (surface via `MCPORTER_STDIO_LOGS=1` or on non-zero exits). Single-server listings now show TypeScript-style signatures, return hints, and inline examples that match the new function-style call syntax.
- Added ad-hoc server support across `mcporter list`/`call`: point at any `--http-url` or `--stdio` command (plus `--env`, `--cwd`, `--name`, `--persist`) without touching config, and persist the generated definition when desired. Documented the workflow in `docs/adhoc.md`.
- Upgraded `mcporter call` with JavaScript-like call expressions (`mcporter call 'linear.create_issue(title: "Bug", team: "ENG")'`) and an auto-correction heuristic that retries obvious typos or suggests the closest tool when confidence is low. The behaviour is covered in `docs/call-syntax.md` and `docs/call-heuristic.md`.

## [0.2.0] - 2025-11-06

- Added non-blocking `mcporter list` output with per-server status and parallel discovery.
- Introduced `mcporter auth <server>` helper (and library API support) so OAuth flows don’t hang list calls.
- Set the default list timeout to 30 s (configurable via `MCPORTER_LIST_TIMEOUT`).
- Tuned runtime connection handling to avoid launching OAuth flows when auto-authorization is disabled and to reuse cached clients safely.
- Added `mcporter auth <server> --reset` to wipe cached credentials before rerunning OAuth.
- `mcporter list` now prints `[source: …]` (and `Source:` in single-server mode) for servers imported from other configs so you can see whether an entry came from Cursor, Claude, etc.
- Added a `--timeout <ms>` flag to `mcporter list` to override the per-server discovery timeout without touching environment variables.

- Generated CLIs now show full command signatures in help and support `--compile` without leaving template/bundle intermediates.
- StdIO-backed MCP servers now receive resolved environment overrides, so API keys flow through to launched processes like `obsidian-mcp-server`.
- Hardened the CLI generator to surface enum defaults/metadata and added regression tests around the new helper utilities.
- Generated artifacts now emit `<artifact>.metadata.json` files plus `mcporter inspect-cli` / `mcporter regenerate-cli` workflows (with `--dry-run` and overrides) so binaries can be refreshed after upgrading mcporter.
- Fixed `mcporter call <server> <tool>` so the second positional is treated as the tool name instead of triggering the "Argument must be key=value" error, accepted `tool=`/`command=` selectors now play nicely with additional key=value payloads, and added a default call timeout (configurable via `MCPORTER_CALL_TIMEOUT` or `--timeout`) that tears down the MCP transport—clearing internal timers and ignoring blank env overrides—so long-running or completed tools can’t leave the CLI hanging open.

## [0.1.0]

- Initial release.
