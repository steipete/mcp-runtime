---
summary: 'High-level overview of mcporter’s runtime, entry points, and reusable helpers.'
read_when:
  - 'Onboarding to this repository or explaining mcporter to others'
---

# mcporter Overview

mcporter is the Sweetistics CLI + runtime for the Model Context Protocol (MCP). It wraps the upstream TypeScript SDK with:

- **Runtime orchestration** – `createRuntime` loads servers from config JSON, editor imports, or ad-hoc flags and handles OAuth retries, transport promotion, and cleanup.
- **CLI surfaces** – `mcporter list`, `mcporter call`, `mcporter generate-cli`, `mcporter generate-skill`, `mcporter emit-ts`, and `mcporter inspect-cli` expose the runtime features to humans and scripts.
- **Tooling helpers** – `createServerProxy` maps MCP tools to camelCase methods for Node/Bun scripts and returns `CallResult` helpers (`.text()`, `.markdown()`, `.json()`).

## Primary Commands

- `npx mcporter list [server|--http-url|--stdio]`  
  Lists tool metadata, renders TypeScript-style signatures, and surfaces copy/pasteable examples (including ad-hoc HTTP selectors).
- `npx mcporter call server.tool key=value …`  
  Invokes a tool via either flag syntax or the function-call expression form; add `--output json` to capture structured responses.
- `npx mcporter generate-cli --server name [--bundle|--compile]`  
  Emits a standalone CLI for a single MCP server. Bundling defaults to Rolldown unless the runtime resolves to Bun; compiled binaries require Bun.
- `npx mcporter generate-skill --server name`  
  Emits a skill folder (with tool docs and a ready-to-use MCPorter config) for a single MCP server.
- `npx mcporter emit-ts <server> --mode types|client`  
  Produces `.d.ts` files or typed client factories that mirror the CLI schema output.
- `npx mcporter inspect-cli dist/server.js`  
  Reads embedded metadata so you can regenerate a CLI without guesswork.

## Runtime Helpers

Use `createServerProxy(runtime, name)` inside scripts when you want ergonomic camelCase calls instead of kebab-case tool names. The proxy:

1. Validates arguments against the MCP schema.
2. Automatically merges default values.
3. Returns a `CallResult` helper so you can render `.text()`, `.markdown()`, or `.json()` without manual parsing.

When you need raw access (custom transports, streaming), use the bare `Client` from `@modelcontextprotocol/sdk` or inspect `runtime.connect(name)` for lower-level control.

## Debug + Support Docs

- **Ad-hoc MCP Servers** (`docs/adhoc.md`) – explains the `--http-url` / `--stdio` flags.
- **Tool Calling Cheatsheet** (`docs/tool-calling.md`) – shows the two argument styles and when to use each.
- **Hang Diagnostics** (`docs/hang-debug.md` + `docs/tmux.md`) – run long-lived commands inside tmux and dump active handles if shutdown stalls.

Read these docs (via `pnpm run docs:list`) whenever your task touches the corresponding area. They contain the up-to-date guardrails used across Sweetistics repositories.
