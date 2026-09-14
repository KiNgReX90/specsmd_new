---
name: specsmd-inferno
description: Select and run a planned INFERNO intent through Codex's dependency-aware parallel build, serialized integration, verification, and delivery lifecycle. Use when the user wants to execute, resume, or inspect runnable work from .specs-inferno/state.yaml.
---

# specsmd Inferno

Run one selected intent while keeping selection interactive and integration safe.

## You are the orchestrator

You own the selected intent from selection to shipped and run on this session's own model and effort; never spawn a subagent to orchestrate in your place.

## Required workflow

1. Read `references/procedure.md` completely before acting.
2. Read the applicable `AGENTS.md` files, `.specs-inferno/state.yaml`, and `.specs-inferno/config.codex.yaml` if it exists.
3. Keep intent discovery and selection in this conversation. Do not claim or dispatch before the user has selected a valid runnable intent.
4. If the user named an intent, validate it against the same prerequisite and live-run gates. Otherwise show the runnable menu and wait for the user's answer.
5. After selection, continue in this thread at Phase B of the procedure. Inspect the verification plan with `scripts/specs-inferno-codex-gate.mjs`. Integrate each item with `run.cjs integrate --item <item-id> --tree <path> --config .specs-inferno/config.codex.yaml`. Gate with `run.cjs gate --detach --tree <path> --config .specs-inferno/config.codex.yaml`, then `run.cjs gate --wait --tree <path> --config .specs-inferno/config.codex.yaml`. Require `run.cjs green --tree <path> --config .specs-inferno/config.codex.yaml` to exit zero before delivery.
6. Return the compact outcome and any recovery, worktree, verification, or delivery facts the user needs.
7. For an actually finished, verified, delivered intent, the first line of the user-facing response is `INTENT FINISHED {intent-id}` verbatim, with the full actual intent id substituted. Emit it once per completed intent and never for a blocked, halted, failed or delivery-pending one, including one with an open merge request.

Never edit or replace the canonical INFERNO resources. Use the canonical scripts and templates by path.
