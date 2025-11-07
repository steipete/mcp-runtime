# `mcporter emit-ts` Plan

## Why

Our "agents call TypeScript via our proxy" mode and external integrators both need a
stable, IDE-friendly description of each MCP server. Today they either scrape
`mcporter list` output or parse JSON schema on the fly, which is brittle and
impossible to type-check. An `emit-ts` command gives us a single, reproducible
artifact (Think `.ts`/`.d.ts`) that mirrors the pseudo-TypeScript we already
print, so:

- Agents get autocompletion + type safety when composing calls.
- We can run `tsc` against agent-generated snippets before invoking remote tools.
- The exported contract doubles as documentation and feeds future generators.

## CLI Surface

```
mcporter emit-ts <server> --out linear-tools.ts [--mode types|client] [--include-optional]
```

- Default `--mode types`: emits TypeScript declarations only.
- `--mode client`: emits executable wrappers that internally use `createServerProxy`.
- `--include-optional`: mirror `mcporter list --all-parameters` to include every
  parameter in the signature.
- `--force`: overwrite existing files (optional).

## Output Modes

### 1. Types (default)

- File layout:
  - Header comment with generator metadata + source definition.
  - `export interface <ServerName>Tools { ... }` – each method matches
    `ToolDocModel.tsSignature` minus the leading `function` keyword.
  - Optional type aliases for inferred return types (when schemas expose titles).
  - Doc comments pulled verbatim from `doc.docLines`.
  - Inline hints (optional summary / flag usage) emitted as `//` comments.
- No runtime imports; safe as `.d.ts`.

### 2. Client wrappers (`--mode client`)

- Imports `createRuntime`, `createServerProxy`, `createCallResult`.
- Emits the same interface (either inline or `import type` from the types file).
- Provides a factory/helper:
  ```ts
  export async function createLinearClient(runtime?: Runtime) {
    const proxied = runtime ?? (await createRuntime());
    const proxy = createServerProxy(proxied, 'linear');
    return {
      async list_comments(params: Parameters<LinearTools['list_comments']>[0]) {
        const result = await proxy.list_comments(params);
        return createCallResult(result);
      },
      // …
    } satisfies LinearTools;
  }
  ```
- Optionally include a class wrapper or `withLinearClient(cb)` helper that sets up
  and tears down the runtime automatically.

## Implementation Steps

1. **Command wiring**
   - Add `emit-ts` subcommand (or `--emit-ts` flag to `list`). Prefer dedicated
     command so it’s easier to provide mutually exclusive options.
   - Parse `--server`, `--out`, `--mode`, `--include-optional`, `--force`.

2. **Doc model reuse**
   - `runtime.listTools(... includeSchema: true)` → map tools → `buildToolDoc`.
   - Pass `{ requiredOnly: !includeOptional }` so signatures match CLI defaults.

3. **Template rendering**
   - Mode-specific renderers consume `ToolDocModel` arrays and output strings.
   - Types mode: convert `doc.docLines` to `/****/`, emit `doc.tsSignature` and
     optional summary hints.
   - Client mode: reuse types renderer plus wrapper code.

4. **Filesystem + metadata**
   - Write to `--out`; prevent overwrite unless `--force`.
   - Optionally emit sibling `.d.ts` + `.ts` when using client mode.
   - Record metadata (similar to CLI generator) so `mcporter inspect-cli` can
     show when/how the file was generated.

5. **Testing**
   - Unit: add template-focused tests that snapshot the generated strings for a
     fixture server (use `tests/emit-ts.test.ts`).
   - Integration: run `mcporter emit-ts integration --out tmp/integration-tools.ts`
     during Vitest, then:
       * `tsc --noEmit` to ensure types compile.
       * In client mode, `ts-node` a script that `mock` runtime + asserts the
         wrapper calls the proxy with expected params.

6. **Docs**
   - Update `docs/call-syntax.md` (or new `docs/emit-ts.md`) with before/after
     samples showing both modes and how to import them.
   - Mention the feature in `README` and changelog once shipped.

## Open Questions

- Do we emit `unknown` for missing schemas or wrap the result in `CallResult`?
  *Proposal*: emit `CallResult` wrappers in client mode, `unknown` return types in
  types mode plus a comment.
- Should client mode also manage runtime lifecycle (auto-close)? Maybe expose both
  `createClient(runtime)` and `withClient(cb)`.
- Where do we store generated files inside the repo? (Default to current working
  directory unless `--out` contains a path.)

---
Next actions: implement the CLI command + templates, add tests/docs, and wire it
into our proxy tooling once the emitted files exist.
