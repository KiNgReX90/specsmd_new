---
name: specsmd-inferno-planner
description: Capture, reconcile, and decompose INFERNO intents into dependency-safe work items. Use to create a new intent, repair an incomplete plan, or prepare .specs-inferno artifacts before execution.
---

# specsmd Inferno Planner

Create executable intent artifacts; never start their build.

## Required workflow

1. Read `references/procedure.md` completely before acting.
2. Read applicable `AGENTS.md` files and, when present, `.specs-inferno/state.yaml` and `.specs-inferno/config.codex.yaml`.
3. If first-run configuration is absent, complete the `$specsmd-inferno-config` display-and-confirm gate first.
4. Spawn the `specsmd_inferno_planner` custom agent with the user's planning goal, repository root, procedure path, constraints and existing authorization.
5. The planner makes every planning decision, renders every artifact itself, and alone updates state.
6. Scan each planned intent with `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs scan --only wiring --plan <intent-id> --config .specs-inferno/config.codex.yaml` and follow everything it prints, act on the triage verdict below, then return the planning summary and stop; `$specsmd-inferno` builds an intent.

Use the canonical templates by path and preserve their artifact contracts.

## The triage verdict

The planner reports `Triage: direct` or `Triage: intent, because <the letter and one clause>` on its first line, and never asks the user anything.

1. On `Triage: direct`, build it, without asking anybody.
2. On a host with `integration/TEST-CASES.md`, land every reserved tester case id before any build starts, in one call: `node scripts/tester/reserve-cases.mjs --intent <intent-id> TC-<n> "<title>" [...]`. Exit 2 is a collision and prints the next free id; resume the planner with the replacement id.
3. Send a recipe marked `hard: yes`, and any `oracle` block, to the `specsmd_inferno_oracle` custom agent first; its decision goes into the builder's assignment as written.
4. Dispatch each direct recipe to the `specsmd_inferno_builder_strong` custom agent with the recipe's own lines. Neither the oracle nor the planner builds anything.
