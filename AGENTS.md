<shared>
# AGENTS.md

Shared guardrails distilled from the various `~/Projects/*/AGENTS.md` files (state as of **November 15, 2025**). This document highlights the rules that show up again and again; still read the repo-local instructions before making changes.

## Codex Global Instructions
- Keep the system-wide Codex guidance at `~/.codex/AGENTS.md` (the Codex home; override via `CODEX_HOME` if needed) so every task inherits these rules by default.

## General Guardrails

### Intake & Scoping
- Open the local agent instructions plus any `docs:list` summaries at the start of every session. Re-run those helpers whenever you suspect the docs may have changed.
- Review any referenced tmux panes, CI logs, or failing command transcripts so you understand the most recent context before writing code.

### Tooling & Command Wrappers
- Use the command wrappers provided by the workspace (`./runner …`, `scripts/committer`, `pnpm mcp:*`, etc.). Skip them only for trivial read-only shell commands if that’s explicitly allowed.
- Stick to the package manager and runtime mandated by the repo (pnpm-only, bun-only, swift-only, go-only, etc.). Never swap in alternatives without approval.
- When editing shared guardrail scripts (runners, committer helpers, browser tools, etc.), mirror the same change back into the `agent-scripts` folder so the canonical copy stays current.
- Ask the user before adding dependencies, changing build tooling, or altering project-wide configuration.
- Keep the project’s `AGENTS.md` `<tools></tools>` block in sync with the full tool list from `TOOLS.md` so downstream repos get the latest tool descriptions.

### tmux & Long Tasks
- Run any command that could hang (tests, servers, log streams, browser automation) inside tmux using the repository’s preferred entry point.
- Do not wrap tmux commands in infinite polling loops. Run the job, sleep briefly (≤30 s), capture output, and surface status at least once per minute.
- Document which sessions you create and clean them up when they are no longer needed unless the workflow explicitly calls for persistent watchers.

### Build, Test & Verification
- Before handing off work, run the full “green gate” for that repo (lint, type-check, tests, doc scripts, etc.). Follow the same command set humans run—no ad-hoc shortcuts.
- Leave existing watchers running unless the owner tells you to stop them; keep their tmux panes healthy if you started them.
- Treat every bug fix as a chance to add or extend automated tests that prove the behavior.
- When someone asks to “fix CI,” use the GitHub CLI (`gh`) to inspect, rerun, and unblock failing workflows on GitHub until they are green.

### Code Quality & Naming
- Refactor in place. Never create duplicate files with suffixes such as “V2”, “New”, or “Fixed”; update the canonical file and remove obsolete paths entirely.
- Favor strict typing: avoid `any`, untyped dictionaries, or generic type erasure unless absolutely required. Prefer concrete structs/enums and mark public concurrency surfaces appropriately.
- Keep files at a manageable size. When a file grows unwieldy, extract helpers or new modules instead of letting it bloat.
- Match the repo’s established style (commit conventions, formatting tools, component patterns, etc.) by studying existing code before introducing new patterns.

### Git, Commits & Releases
- Invoke git through the provided wrappers, especially for status, diffs, and commits. Only commit or push when the user asks you to do so.
- Follow the documented release or deployment checklists instead of inventing new steps.
- Do not delete or rename unfamiliar files without double-checking with the user or the repo instructions.

### Documentation & Knowledge Capture
- Update existing docs whenever your change affects them, including front-matter metadata if the repo’s `docs:list` tooling depends on it.
- Only create new documentation when the user or local instructions explicitly request it; otherwise, edit the canonical file in place.
- When you uncover a reproducible tooling or CI issue, record the repro steps and workaround in the designated troubleshooting doc for that repo.

### Troubleshooting & Observability
- Design workflows so they are observable without constant babysitting: use tmux panes, CI logs, log-tail scripts, MCP/browser helpers, and similar tooling to surface progress.
- If you get stuck, consult external references (web search, official docs, Stack Overflow, etc.) before escalating, and record any insights you find for the next agent.
- Keep any polling or progress loops bounded to protect hang detectors and make it obvious when something stalls.

### Stack-Specific Reminders
- Start background builders or watchers using the automation provided by the repo (daemon scripts, tmux-based dev servers, etc.) instead of running binaries directly.
- Use the official CLI wrappers for browser automation, screenshotting, or MCP interactions rather than crafting new ad-hoc scripts.
- Respect each workspace’s testing cadence (e.g., always running the main `check` script after edits, never launching forbidden dev servers, keeping replies concise when requested).

## Swift Projects
- Kick off the workspace’s build daemon or helper before running any Swift CLI or app; rely on the provided wrapper to rebuild targets automatically instead of launching stale binaries.
- Validate changes with `swift build` and the relevant filtered test suites, documenting any compiler crashes and rewriting problematic constructs immediately so the suite can keep running.
- Keep concurrency annotations (`Sendable`, actors, structured tasks) accurate and prefer static imports over dynamic runtime lookups that break ahead-of-time compilation.
- Avoid editing derived artifacts or generated bundles directly—adjust the sources and let the build pipeline regenerate outputs.
- When encountering toolchain instability, capture the repro steps in the designated troubleshooting doc and note any required cache cleans (DerivedData, SwiftPM caches) you perform.

## TypeScript Projects
- Use the package manager declared by the workspace (often `pnpm` or `bun`) and run every command through the same wrapper humans use; do not substitute `npm`/`yarn` or bypass the runner.
- Start each session by running the repo’s doc-index script (commonly a `docs:list` helper), then keep required watchers (`lint:watch`, `test:watch`, dev servers) running inside tmux unless told otherwise.
- Treat `lint`, `typecheck`, and `test` commands (e.g., `pnpm run check`, `bun run typecheck`) as mandatory gates before handing off work; surface any failures with their exact command output.
- Maintain strict typing—avoid `any`, prefer utility helpers already provided by the repo, and keep shared guardrail scripts (runner, committer, browser helpers) consistent by syncing back to `agent-scripts` when they change.
- When editing UI code, follow the established component patterns (Tailwind via helper utilities, TanStack Query for data flow, etc.) and keep files under the preferred size limit by extracting helpers proactively.

Keep this master file up to date as you notice new rules that recur across repositories, and reflect those updates back into every workspace’s local guardrail documents.

</shared>

<tools>
# TOOLS

Edit guidance: keep the actual tool list inside the `<tools></tools>` block below so downstream AGENTS syncs can copy the block contents verbatim (without wrapping twice).

<tools>
- `runner`: Bash shim that routes every command through Bun guardrails (timeouts, git policy, safe deletes).
- `git` / `bin/git`: Git shim that forces git through the guardrails; use `./git --help` to inspect.
- `scripts/committer`: Stages the files you list and creates the commit safely.
- `scripts/docs-list.ts`: Walks `docs/`, enforces front-matter, prints summaries; run `tsx scripts/docs-list.ts`.
- `scripts/browser-tools.ts`: Chrome helper for remote control/screenshot/eval; run `ts-node scripts/browser-tools.ts --help`.
- `scripts/runner.ts`: Bun implementation backing `runner`; run `bun scripts/runner.ts --help`.
- `bin/sleep`: Sleep shim that enforces the 30s ceiling; run `bin/sleep --help`.
- `xcp`: Xcode project/workspace helper; run `xcp --help`.
- `oracle`: CLI to bundle prompt + files for another AI; run `npx -y @steipete/oracle --help`.
- `mcporter`: MCP launcher for any registered MCP server; run `npx mcporter`.
- `iterm`: Full TTY terminal via MCP; run `npx mcporter iterm`.
- `firecrawl`: MCP-powered site fetcher to Markdown; run `npx mcporter firecrawl`.
- `XcodeBuildMCP`: MCP wrapper around Xcode tooling; run `npx mcporter XcodeBuildMCP`.
- `gh`: GitHub CLI for PRs, CI logs, releases, repo queries; run `gh help`.
</tools>

</tools>

# Repository Guidelines


If you are unsure about sth, just google it.

## Project Structure & Module Organization
- `src/`: TypeScript source for the runtime and CLI entry points (`cli.ts`, `runtime.ts`, etc.).
- `tests/`: Vitest suites mirroring runtime behaviors; integration specs live alongside unit tests.
- `docs/`: Reference material for MCP usage and server coordination.
- `dist/`: Generated build artifacts; never edit by hand.

## Build, Test, and Development Commands
- `pnpm build`: Emits compiled JS and type declarations via `tsc -p tsconfig.build.json`.
- `pnpm lint`: Runs Biome style checks, Oxlint+tsgolint rules, and a `tsgo --noEmit` type pass.
- `pnpm test`: Default test target (quiet reporters + suppressed stdout for passing tests) so CLI fixture logs don’t take over the terminal.
- `pnpm test:quiet`: Alias for `pnpm test` when you want to be explicit about the quiet mode.
- `pnpm test:verbose`: Executes the Vitest suite with the default reporter for full CLI transcripts.
- `pnpm dev`: Watches and incrementally rebuilds the library with TypeScript.
- `pnpm clean`: Removes `dist/` so you can verify fresh builds.
- `pnpm run docs:list`: Lists required rule summaries via `scripts/docs-list.ts`; run this at the start of every session and reopen any referenced doc before writing code.
- `tmux new-session -- pnpm mcporter:list`: Exercise the CLI in a resilient terminal; tmux makes it easy to spot stalls or hung servers.
- `gh run list --limit 1 --watch`: Stream CI status in real time; use `gh run view --log` on the returned run id to inspect failures quickly.

## Guardrail Tooling (runner/git wrappers)
- Use `./runner <command>` for every non-trivial shell command (tests, builds, npm, node, bun, etc.). The Bun-backed runner enforces timeouts, blocks risky subcommands, and keeps logs consistent. Only simple read-only tools (e.g., `cat`, `ls`, `rg`) may bypass it.
- When you must run git, invoke it through the wrapper: `./runner git status -sb`, `./runner git diff`, or `./runner git log`. Those are the only git subcommands permitted. Never run `git push` unless the user asks explicitly, and even then go through `./runner git push`.
- These runner/committer rules only apply to this mcporter repo—other repositories should use their own native tooling (no cross-repo runner reuse).
- Never call `git add` / `git commit` directly. To create a commit, list the exact paths via `./scripts/committer "type: summary" path/to/file1 path/to/file2`.
- If you need to run the Bun-based git policy helper directly, you can use `./git ...`, but prefer `./runner git ...` so logging stays uniform.

## Agent Scripts Mirror
- The guardrail helpers (`runner`, `scripts/runner.ts`, `scripts/committer`, `bin/git`, `scripts/git-policy.ts`, `scripts/docs-list.ts`, etc.) are mirrored in `~/Projects/agent-scripts`. Any time you edit one of these files here, immediately copy the same change into the mirror (and vice versa) before moving on so the two repos stay byte-for-byte identical.
- When the user says “sync agent scripts,” jump to `~/Projects/agent-scripts`, update it (respecting the git guardrails), diff against this repo, and reconcile changes in both directions. Keep syncing until both repos are clean and committed.

## Coding Style & Naming Conventions
- TypeScript files use 2-space indentation, modern ES module syntax, and `strict` compiler settings.
- Imports stay sorted logically; prefer relative paths within `src/`.
- Run `pnpm lint:biome` before committing to auto-fix formatting; `pnpm lint:oxlint` enforces additional TypeScript rules powered by tsgolint.
- Use descriptive function and symbol names (`createRuntime`, `StreamableHTTPServerTransport`) and favor `const` for bindings.

## Testing Guidelines
- Add unit tests under `tests/`; mirror filename (`runtime.test.ts`) against the module under test.
- Use Vitest’s `describe/it/expect` APIs; keep asynchronous tests `async` to match runtime usage.
- For integration scenarios, reuse the HTTP harness shown in `tests/runtime-integration.test.ts` and ensure transports close in `afterAll`.
- Validate new work with `pnpm test` and confirm `pnpm lint` stays green.

## Changelog Guidelines
- Focus on user-facing behavior changes; avoid calling out internal testing-only updates.
- **Never mention doc-only edits** in the changelog. If a change only touches docs (or docs + tests) leave the changelog untouched. Only add entries when runtime behavior, CLI UX, or generated artifacts change.

## Commit & Pull Request Guidelines
- Use Conventional Commits (https://www.conventionalcommits.org/en/v1.0.0/) with the allowed types `feat|fix|refactor|build|ci|chore|docs|style|perf|test`, optional scopes (`type(scope): description`), and `!` for breaking changes (e.g., `feat: Prevent racing of requests`, `chore!: Drop support for iOS 16`).
- Commits should be scoped and written in imperative mood (`feat: add runtime cache eviction`, `fix(cli): ensure list handles empty config`).
- Reference related issues in the body (`Refs #123`) and describe observable behavior changes.
- Pull requests should summarize the change set, list verification steps (`pnpm lint`, `pnpm test`), and include screenshots or logs when CLI output changes.

## Security & Configuration Tips
- Keep secrets out of the repo; pass credentials via environment variables when exercising MCP servers.
- Local scripts under `scripts/` (e.g., `mcp_signoz_retry_patch.cjs`) are safe shims for Sweetistics workflows—review them before extending.

## Common mcporter Workflows & Shortcuts
- **List configured servers**: `npx mcporter list [--json]` shows health, counts, and hints; re-run with `--server <name>` for focused detail.
- **Ad-hoc HTTP**: `npx mcporter call https://host/path.toolName(arg: "value")` automatically infers transport; add `--allow-http` for plain HTTP.
- **Ad-hoc stdio / third-party packages**: `npx mcporter call --stdio "npx -y package@latest" --name friendly-name <tool>` launches transient MCP servers (ideal for Chrome DevTools or Playwright friends with no config).
- **Generate standalone CLIs**: `npx mcporter generate-cli <server-or-adhoc-flags> --output cli.ts [--bundle dist/cli.js --compile]` embeds schema+commands; combine with `--stdio`/`--http-url` to avoid editing configs.
- **Emit typed clients**: `npx mcporter emit-ts <server> --mode client --out clients/name.ts [--include-optional]` for TypeScript interfaces + helper factories (use `--mode types` for `.d.ts` only).
- **Inspect/Regenerate artifacts**: `npx mcporter inspect-cli dist/thing.js` prints metadata and replay command; `npx mcporter generate-cli --from dist/thing.js` reruns with the latest mcporter.

## Release Reminders
- Always read `docs/RELEASE.md` before starting a release; follow every step (including Homebrew + docs updates) before tagging/publishing.
- Global help automatically short-circuits regardless of command inference. Use `mcporter help list` if you need command-specific detail.
- Global help automatically short-circuits regardless of command inference. Use `mcporter help list` if you need command-specific detail.
