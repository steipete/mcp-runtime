---
summary: 'Status tracker for post-launch refactors, shared utilities, and remaining cleanup tasks.'
read_when:
  - 'Scoping engineering work beyond immediate feature changes'
---

# Next-Step Refactor Checklist

This doc tracks remaining reuse/refactor work now that the original plan is done.
Each section lists the goal, why it matters, and the concrete steps/tests needed.

## 1. Shared Tool Schema Cache *(Completed)*
- **Problem**: `generate-cli` and `emit-ts` both fetch & serialize tool schemas
  independently (and `mcporter list` re-parses them too).
- **What we did**:
  1. Added `src/cli/tool-cache.ts` with `loadToolMetadata()` caching tool metadata per runtime/server/options.
  2. Switched `mcporter list` (single-server path) and `emit-ts` to consume the helper, so both reuse `ToolMetadata`.
  3. Added `tests/tool-cache.test.ts` + updated emit-ts tests to ensure the helper is covered.
- **Next**: Consider integrating the cache into `generate-cli` if we ever reuse runtime instances there.

## 2. Unified Flag Parsing for Generator-style Commands *(Completed)*
- **Problem**: `generate-cli`, the (now legacy) `regenerate-cli` wrapper, and `emit-ts` each
  reimplemented `--runtime`, `--timeout`, and `--include-optional` handling.
- **What we did**:
  1. Added `extractGeneratorFlags()` in `src/cli/generate/flag-parser.ts` to
     normalize shared flags while mutating `args` in place.
  2. Updated all three commands to call the helper before parsing
     command-specific options.
  3. Added `tests/generator-flag-parser.test.ts` to cover runtime/timeout and
     optional flags.

## 3. Test Fixture Reuse *(Completed)*
- **Problem**: Emit-ts/tool-cache/unit tests each defined their own tool/definition
  fixtures, leading to divergence.
- **What we did**:
  1. Added `tests/fixtures/tool-fixtures.ts` (shared definition + tools).
  2. Updated `tests/emit-ts.test.ts` and `tests/tool-cache.test.ts` to import
     the shared fixtures (and reuse them via `buildToolMetadata`).
  3. Ensured the fixture covers required+optional parameters so both suites hit
     the same edge cases.

## 4. CallResult Helper Extraction *(Completed)*
- **Problem**: `call-command.ts` and the emit-ts client template both wrapped
  results with `createCallResult`, but there was no shared helper.
- **What we did**:
  1. Added `wrapCallResult()` to `result-utils.ts` and exported it from the
     package entry.
  2. Updated `call-command.ts` and the emit-ts template to reuse the helper so
     they stay in sync.
  3. Adjusted emit-ts tests to assert the helper is referenced.

## 5. CLI Docs Consolidation *(Completed)*
- **Problem**: CLI usage guidance was scattered across README, `docs/spec.md`,
  and various feature docs.
- **What we did**:
  1. Added `docs/cli-reference.md` summarizing `list`, `call`, `generate-cli`,
     and `emit-ts` flags/modes in one place.
  2. Pointed emit-ts users to that doc so we can converge other references over
     time (no README/spec churn yet to avoid clobbering parallel work).
- **Next**: Once the other doc changes land, update README/spec to link to the
  reference and drop redundant sections.

## 6. Runtime Module Split *(Completed)*
- **Problem**: `src/runtime.ts` had grown bulky (600+ lines) mixing transport setup, OAuth flow control, and small helpers, making tests and reuse harder.
- **What we did**:
  1. Extracted transport construction/retry logic to `src/runtime/transport.ts`.
  2. Moved OAuth helpers (timeouts, connect retry, errors) to `src/runtime/oauth.ts` and centralized env-parsed timeouts.
  3. Pulled argument/timeout utilities into `src/runtime/utils.ts`.
  4. Made reset-policy logic reusable via `src/runtime/errors.ts`.
  5. Switched tests to import helpers directly instead of using `runtime.__test`.
  6. Added a targeted transport test to cover SSE fallback and OAuth promotion.
- **Next**: Keep new helpers in sync as runtime evolves; prefer adding surface to these modules over growing `runtime.ts` again.

---
Tracking the above here keeps future agents aligned. Update this checklist as
items ship (mark sections “Completed” when done, or delete the doc once empty).
