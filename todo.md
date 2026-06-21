# TODO

## Research/Explore Flow

Create a research agent or explore flow that generates exploration outputs consumable by all three AI-DLC phases (Inception, Construction, Operations).

**Use Cases:**
- Learning new protocols (Agentic Commerce Protocol, Agentic Client Protocol)
- Exploring unfamiliar tech stacks (Electron apps, new frameworks)
- Deep-diving into documentation and best practices

**Workflow:**
- Extended thinking for synthesis and analysis
- Web search for current information
- Report generation as structured output

**Output:**
- Exploration reports that become inputs for AI-DLC flows
- Could generate ad-hoc skills (similar to Claude Code frontend-design skill pattern)
- Knowledge artifacts stored in memory-bank for reuse

**Idea:** System creates skills on-the-fly based on research, so domain knowledge persists and can be invoked later.

## Planner: are work-item writers actually parallel?

Verify whether, when the planner writes out the work-item artifacts, multiple
writers run **in parallel** or one-at-a-time.

**Suspicion:** items appear to be written **sequentially**, not in parallel.

**Goal:** if they're sequential, fan them out so the writers run concurrently and
the whole planning/writing pass finishes faster.

**Action:** trace the planner → writer dispatch path and confirm whether each
work-item artifact gets its own concurrent writer or whether they're awaited one
after another. Fix to parallel if it's serial.

## Autonomy "full" vs "review" mode — the agent confuses the two

There are two stop points and the model conflates them:

- **Full autonomy:** when capturing an intent, the agent writes **all** the work
  items and then **stops**. This is correct — it should always stop there.
- **Review mode:** stops **later**, and requires the user to **confirm all the
  work items** before continuing.

**The confusion:** after the agent writes all the work items and stops (the
correct full-autonomy behavior), it then thinks it's now in **review** mode — i.e.
it treats "stopped after writing all work items" as if review were the active
mode, and starts asking to confirm the work items.

**Action:** make the distinction explicit in the agent's instructions so the
full-autonomy stop and the review-mode confirm-all-items stop can't be mixed up.
Stopping after writing all work items under full autonomy is **not** review mode and
must not trigger the confirm-all-items flow.

