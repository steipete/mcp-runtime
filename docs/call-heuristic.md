# Call Command Auto-Correction

`mcporter call` aims to help when a tool name is *almost* correct without hiding real mistakes.

## Confident Matches → Auto-Correct
- We normalise tool names (strip punctuation, lowercase) and compute a Levenshtein distance.
- If the distance is ≤ `max(2, floor(length × 0.3))`, or the names only differ by case/punctuation, we retry automatically.
- A dim informational line explains the correction: `[mcporter] Auto-corrected tool call to linear.list_issues (input: linear.listIssues).`

## Low-Confidence Matches → Suggest
- When the best candidate falls outside the threshold we keep the original failure.
- We still print a hint so the user learns the canonical name: `[mcporter] Did you mean linear.list_issue_statuses?`
- No second call is attempted in this case.

## Edge Cases
- We only inspect the tool catalog if the server explicitly replied with “Tool … not found”. Other MCP errors surface untouched.
- If listing tools itself fails (auth, offline, etc.) we skip both auto-correct and hints.
- Behaviour is covered by `tests/cli-call.test.ts`.

## Server Selection Heuristic

- `mcporter list <server>` now applies the same edit-distance heuristic to server names. If you type `vercek`, the CLI auto-corrects to `vercel` (and logs `[mcporter] Auto-corrected server name to vercel (input: vercek).`).
- When the typo is too large, we keep the original failure but emit a hint: `[mcporter] Did you mean linear?` followed by the usual “Unknown MCP server …” line. This avoids giant stack traces while pointing to the right name.
- The heuristic considers every configured server (including ad-hoc ones registered via `--http-url/--stdio`). Tests covering this behaviour live in `tests/cli-list.test.ts`.
