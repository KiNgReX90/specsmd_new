---
name: specsmd-inferno-intents
description: List current INFERNO intents from the canonical selector without claiming or starting work. Use when the user asks to see current, available, blocked, parked, running, recovery, or leftover INFERNO intents.
---

# specsmd Inferno Intents

Run this command from the repository root:

```bash
node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs select --json
```

Render the complete JSON output as one Markdown table with exactly these columns, and do not fence it:

| Intent ID | Status | Work items | Details |
| --- | --- | --- | --- |
| `illustrative-ready-intent` | **Ready** | 2 high | Tests: TC-EXAMPLE-1, TC-EXAMPLE-2 |

Preserve the selector's group order and every intent in claimable, blocked, parked, running, recovery, and leftovers. Map their statuses as claimable = **Ready**, blocked = **Blocked**, parked = **Parked**, running = **Running**, recovery = **Recovery**, and leftovers = **Leftover**. The first cell of every row must begin with the full, exact intent id in inline code, on one source line, with no manual wrapping, inserted line breaks, bullet or number prefix, or link replacing it.

In **Work items**, render the grade breakdown after the selector's `items:` label exactly, so `7 items: 7 high` becomes `7 high`; leave the cell blank when the selector supplies no work count. In **Details**, show tester cases, blocker ids, parked and recovery reasons, and the running step when supplied. Preserve those values exactly; leave missing details blank. Keep blocker ids in inline code. Omit process ids, worktree paths, elapsed time, and repeated titles. Escape table pipes and keep detail text within its cell without changing its meaning. Name empty groups once in one compact line after the table, such as `Empty groups: Recovery, Leftover.`, rather than adding fake rows.

The selector JSON remains the only source. Do not omit or abbreviate ids or rows even when the list is long.

Read nothing else to produce the list. Do not read the orchestrator, state, briefs, or work items. Do not claim, unblock, recover, tear down, dispatch, or mutate anything. Do not offer a menu or ask a follow-up question.

To start an intent separately, the user can invoke `$specsmd-inferno <intent-id>`.
