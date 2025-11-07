# CLI ↔ Generator Code Reuse Plan

The goals below align `mcporter list`, the TypeScript CLI generator, and any future TS export modes so we build (and test) formatting logic once.

## 1. Shared Example Rendering

- **Problem**: `list-detail-helpers.ts` shortens `mcporter call` examples, but `generate/template.ts` still prints `--flag` examples via `buildExampleInvocation`.
- **Plan**:
  1. Export a non-colored `formatExampleBlock()` utility (and the internal `truncateExample()` helper) from `list-detail-helpers.ts`.
  2. Import that helper inside `renderToolCommand()` and replace `buildExampleInvocation` with the shared function-call output.
  3. Drop the duplicate `buildExampleInvocation/pickExampleValue` logic once Commander help uses the shared examples.
  4. Update the generator tests (in `tests/generate-cli.test.ts`) to expect the new syntax.

## 2. Optional Summary in Generated Help *(Completed)*

- **Problem**: The runtime CLI prints `// optional (n): …` while generated CLIs enumerate every flag.
- **What we did**:
  1. Reused `selectDisplayOptions()` so both CLI/GH generator decide which params to display.
  2. Added `formatOptionalSummary()` + `buildToolDoc()` wiring so each surface appends the same `// optional (…)` hint only when options were hidden.
  3. Updated `renderToolCommand()` to include the shared hint via `.addHelpText('afterAll', …)` and aligned tests.
- **Next**: No further action unless we change the minimum-visible threshold.

## 3. Consolidate Example Literal Selection

- **Problem**: CLI uses `buildExampleLiteral`/`buildFallbackLiteral`; generator has `pickExampleValue`.
- **Plan**:
  1. Export `pickExampleLiteral(option: GeneratedOption)` from a single module (likely `generate/tools.ts`).
  2. Update `list-detail-helpers.ts` and `renderToolCommand()` to call this shared helper.
  3. Expand helper tests to cover arrays/defaults/enum cases once, keeping both consumers aligned.

## 4. Usage String Builder Parity

- **Problem**: Commander `.usage()` still shows `--flags`, while the rest of the tooling leans on pseudo-TS signatures.
- **Plan**:
  1. Create `buildCliUsage(options: GeneratedOption[], { mode: 'flags' | 'ts' })` that emits both forms.
  2. Use TS mode for `commandTerm`/`help`, but keep flag mode for backwards-compatible CLI docs.
  3. Export the helper so `mcporter list` can reuse it when we eventually add `--flags` view.

## 5. ToolDocModel Abstraction

- **Problem**: Each surface assembles doc comments, signatures, optional summaries, and examples separately.
- **Plan**:
  1. Introduce `buildToolDoc(tool: ServerToolInfo, opts)` returning `{ docLines, signature, optionalSummary, examples[] }`.
  2. `handleList()` and `renderToolCommand()` will render from this struct instead of recomputing each piece.
  3. Unit-test the builder directly to avoid fixture duplication in CLI/generator tests.

## 6. Future TS/DTS Export Mode

- **Goal**: With the shared doc model in place, add `mcporter list <server> --emit-ts <file>` that writes a proxy interface identical to the generated CLI signatures.
- **Steps**:
  1. Reuse `buildToolDoc()` to emit `interface ServerNameTools { … }` plus optional helper functions.
  2. Add docs describing the flag under `docs/call-syntax.md` or a new `docs/ts-export.md`.
  3. Integration test: run the command against a fixture server and assert the emitted file matches the snapshot.

---

Sequencing recommendation:
1. Implement shared example helper (small change, immediate parity). **Done** – `list-detail-helpers.ts` now exports `formatExampleBlock`, `formatCallExpressionExample`, & the generator consumes them.
2. Extract `ToolDocModel` + optional summary builder. **Done** – `buildToolDoc` in `src/cli/list-detail-helpers.ts` now feeds both `handleList` and `renderToolCommand`.
3. Update generator to consume the shared helpers (examples + optional summary + signatures). **In progress** – signatures/examples unified; `ToolDocModel` still pending.
4. Add unit tests for the new helper module.
5. Build the `--emit-ts` mode once reuse is in place.
