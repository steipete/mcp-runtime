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
