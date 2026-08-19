---
name: specsmd-inferno-config
description: Review and update the Codex-specific INFERNO execution configuration at .specs-inferno/config.codex.yaml. Use for first-run setup or changes to autonomy, verification, delivery, agent tiers, halt, or knowledge settings.
---

# specsmd Inferno Config

Configure Codex execution without changing any other host's settings.

## Required workflow

1. Read `references/procedure.md` completely before acting.
2. Read applicable `AGENTS.md` files and the existing `.specs-inferno/config.codex.yaml`, if present.
3. Show the effective current or default settings in plain language and keep confirmation in this parent conversation.
4. After confirmation, spawn `specsmd_inferno_config` with the exact approved values, repository root, and procedure path.
5. Wait for its parse validation result and summarize the effective settings.

Preserve unknown keys and write only `.specs-inferno/config.codex.yaml`.
