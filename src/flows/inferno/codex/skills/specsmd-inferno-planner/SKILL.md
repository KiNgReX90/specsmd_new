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
4. Spawn the `specsmd_inferno_planner` custom agent with the user's planning goal, repository root, procedure path, and the relevant user constraints and existing authorization.
5. The planner makes every planning decision, renders every artifact itself, and alone updates state.
6. Act on the triage verdict below, then return the planning summary and stop. Building remains a separate `$specsmd-inferno` invocation.

Use the canonical templates by path and preserve their artifact contracts.

## The triage verdict

The planner reports `Triage: direct` or `Triage: intent, because <the letter and one clause>` on its first line, and it never asks the user anything.

1. On `Triage: direct`, build it, without asking anybody.
2. Land every reserved tester case id before any build starts, one call for all of them: `node scripts/tester/reserve-cases.mjs --intent <intent-id> TC-<n> "<title>" [...]`. Exit 2 is a collision and prints the next free id; resume the planner with the replacement id.
3. Send a recipe marked `hard: yes`, and any `oracle` block, to the `specsmd_inferno_oracle` custom agent first, and put its decision into the builder's assignment as written.
4. Dispatch each direct recipe to the `specsmd_inferno_builder_strong` custom agent with the recipe's own lines. The oracle builds nothing and the planner builds nothing.
