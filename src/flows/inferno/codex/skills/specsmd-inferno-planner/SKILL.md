---
name: specsmd-inferno-planner
description: Capture, reconcile, and decompose INFERNO intents into dependency-safe work items for Codex. Use when the user wants to create a new intent, repair an incomplete plan, or prepare .specs-inferno artifacts before execution.
---

# specsmd Inferno Planner

Create executable intent artifacts without starting their build.

## Required workflow

1. Read `references/procedure.md` completely before acting.
2. Read applicable `AGENTS.md` files, `.specs-inferno/state.yaml` when present, and `.specs-inferno/config.codex.yaml` when present.
3. If first-run configuration is absent, complete the `$specsmd-inferno-config` display-and-confirm gate first.
4. Spawn the `specsmd_inferno_planner` custom agent with the user's planning goal, repository root, and procedure path.
5. The planner makes every planning decision, fans artifact rendering through `specsmd_inferno_writer`, waits for every writer, and alone updates state.
6. Return the planning summary and stop. Building remains a separate `$specsmd-inferno` invocation.

Use the canonical templates by path and preserve their artifact contracts.
