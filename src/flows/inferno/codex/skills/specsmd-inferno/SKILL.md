---
name: specsmd-inferno
description: Select and run a planned INFERNO intent through Codex's dependency-aware parallel build, serialized integration, verification, and delivery lifecycle. Use when the user wants to execute, resume, or inspect runnable work from .specs-inferno/state.yaml.
---

# specsmd Inferno

Run one selected intent while keeping selection interactive and integration safe.

## Required workflow

1. Read `references/procedure.md` completely before acting.
2. Read the applicable `AGENTS.md` files, `.specs-inferno/state.yaml`, and `.specs-inferno/config.codex.yaml` if it exists.
3. Keep intent discovery and selection in this parent conversation. Do not delegate before the user has selected a valid runnable intent.
4. If the user named an intent, validate it against the same prerequisite and live-run gates. Otherwise show the runnable menu and wait for the user's answer.
5. After selection, spawn the `specsmd_inferno_orchestrator` custom agent with the selected intent id, repository root, and the procedure path. Wait for it and use `followup_task` only for the bounded retry cases in the procedure.
6. Return the orchestrator's compact outcome and any recovery, worktree, verification, or delivery facts the user needs.

Never edit or replace the canonical INFERNO resources. Use the canonical scripts and templates by path.
