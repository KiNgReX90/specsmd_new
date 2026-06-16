---
description: INFERNO Config - create or update .specs-inferno/config.yaml (autonomy level, worker model tiers, finalize verification)
---

# INFERNO Config

**Command**: `/specsmd-inferno-config`

---

## Purpose

Create or update the optional per-project configuration at `.specs-inferno/config.yaml`, read by the INFERNO orchestrator (`.specsmd/inferno/agents/orchestrator/agent.md`) and planner (`.specsmd/inferno/agents/planner/agent.md`). Every key is optional — an absent file still yields a working flow on host/project defaults.

---

## Procedure

1. Read the annotated template `.specsmd/inferno/agents/orchestrator/config.example.yaml`. If `.specs-inferno/config.yaml` already exists, read it and show the user its current values before asking anything.
2. Ask the user, ONE question at a time:
   - **autonomy.level** — *"Run INFERNO fully autonomously (after decomposition, route straight into the orchestrator and start building with no review), or pause after decomposition so you can read the work-item plans first?"* `full` routes into the build automatically; `review` stops after decomposition. Suggest `review`.
   - **models.strong** — worker model for reasoning-bearing items (complexity medium/high). The value is passed VERBATIM as the per-dispatch model override, so it must be in the form the host's dispatch accepts (on Claude Code: the Agent-tool aliases `opus` / `sonnet` / `haiku`). Suggest `opus`.
   - **models.cheap** — worker model for mechanical items (kind config-only/docs-only/test, complexity low). Suggest `sonnet`.
   - **verification.finalize** — the ordered shell commands that are this project's authoritative build/test gate, run once by the orchestrator on the integrated tree before merging. Propose defaults discovered from the repo (e.g. `package.json` scripts) and let the user edit.
   - **Optional extras** — only if the user wants them: `halt.flag_file` + `halt.wait_script` (budget-halt integration) and `knowledge.index` (knowledge-base index path). Skip silently otherwise.
3. The user may answer "skip" to any question — omit that key entirely (the flow's documented fallbacks apply; an omitted `autonomy.level` behaves as `review`).
4. Write `.specs-inferno/config.yaml`, preserving any existing keys you did not ask about. Keep the file minimal: only keys the user actually chose.
5. Show the final file content and remind the user: model values apply to Claude Code subagent dispatch; other hosts (e.g. Codex) resolve models their own way and ignore the tiers.

---

## Routing Targets

- **To INFERNO Orchestrator**: `/specsmd-inferno`

---

## Begin

Activate now. Read the template, then start the questions.
