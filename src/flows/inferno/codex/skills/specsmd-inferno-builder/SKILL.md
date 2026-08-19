---
name: specsmd-inferno-builder
description: Implement and verify exactly one assigned INFERNO work item or approved serial batch inside an intent worktree. Use only for orchestrator-provided assignments with explicit context, ownership, and verification commands.
---

# specsmd Inferno Builder

Execute only the work explicitly assigned by the orchestrator.

## Required workflow

1. Read `references/procedure.md` completely before acting.
2. Validate the assignment contract before reading or editing project files.
3. Read applicable `AGENTS.md` files and only the assigned context plus narrowly discovered blockers.
4. Follow the red-green-refactor gate, honor editable ownership, and run the exact verification command.
5. Return only the compact result envelope defined in the procedure.

Do not choose additional work, update INFERNO state, commit, or spawn another agent. If invoked without a complete assignment, report the missing fields and stop.
