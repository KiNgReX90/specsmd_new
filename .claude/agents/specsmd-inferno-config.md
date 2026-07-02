---
description: INFERNO Config - create or update .specs-inferno/config.yaml (mode, worker model tiers, delivery override, finalize verification)
---

# INFERNO Config

**Command**: `/specsmd-inferno-config`

---

## Purpose

Create or edit the optional per-project configuration at `.specs-inferno/config.yaml`, read by the INFERNO orchestrator (`.specsmd/inferno/agents/orchestrator/agent.md`) and planner (`.specsmd/inferno/agents/planner/agent.md`). `npx specsmd install` scaffolds this file at install time with sane defaults — this command is the guided path to review or change it afterward (switching mode mid-project, tweaking model tiers, adding a finalize gate, etc.). Every key is optional — an absent file still yields a working flow on host/project defaults (behaves as `production`).

---

## Procedure

This is a **display-and-confirm** flow, not an interrogation. Show the current/default settings in plain language, let the user accept everything at once or adjust the few things they care about, and keep raw model IDs in the background. Do NOT walk the user through every key one at a time.

1. Read the annotated template `.specsmd/inferno/agents/orchestrator/config.example.yaml`. If `.specs-inferno/config.yaml` already exists, read it so you display the user's CURRENT values instead of the defaults.
2. **Display the effective settings in plain language**, then ask one question: *"Use these, or adjust?"* Present them roughly like:
   - **Mode** → *production* (staged deep intake questioning, one post-write review pause, delivery defaults to merge-request) or *autonomous* (lean intake, no pause, delivery defaults to auto-close). The build is always a separate step you start later with `/specsmd-inferno`; the planner never starts it, in either mode. *(default: `production`)*
   - **Complex work items** (the reasoning-heavy ones) → handled by the strong model at maximum effort. *(default: `opus`, xhigh)*
   - **Simple work items** (mechanical: config, docs, small swaps) → handled by the fast model. *(default: `sonnet`)*
   - **Plan writing** → drafted in parallel by fast scribe agents. *(default: same as simple)*
   - **Delivery override** → only if they want to pin delivery independent of mode: *auto-close* (build, merge, and close automatically) or *merge-request* (open merge requests for review — per work item into the intent, and the whole intent into your base branch). *(default: derived from mode, above)*
   - **Final check before closing** → the project's build + tests. *(propose what you discover from the repo, e.g. `package.json` scripts)*
   Keep the model names parenthetical/secondary — the user reasons about "complex vs simple work", not about `opus`/`sonnet`.
3. If the user accepts, you're done — write only the non-default keys. If they want to adjust, change only what they name; everything else keeps its default. Map their plain-language choices to keys: mode→`mode`, complex→`models.strong`, simple→`models.cheap`, plan writing→`models.writer`, delivery override→`delivery.mode`, final check→`verification.finalize`.
4. **If delivery ends up as merge-request** (either mode is `production` with no override, or the user explicitly set `delivery.mode: merge-request`), propose the base branch the intent should merge into — the branch you're currently on, or the repo's default branch — and let the user confirm or change it. Record it as `delivery.base_branch` (omit it to let the orchestrator propose-and-confirm at finalize instead).
5. Offer the optional extras only if asked: `halt.flag_file` + `halt.wait_script` (budget-halt) and `knowledge.index`. Skip silently otherwise.
6. Write `.specs-inferno/config.yaml`, preserving any existing keys you did not touch. Keep the file minimal — only keys that differ from the documented defaults. Every key stays optional: an omitted `mode` behaves as `production`; an omitted `delivery.mode` derives from `mode` (production -> merge-request, autonomous -> auto-close); an omitted `models.writer` falls back to `models.cheap`. If the existing config still carries the legacy `autonomy.level` key, offer to migrate it to `mode` (`review` -> `production`, `full` -> `autonomous`) rather than layering `mode` on top of it.
7. Show the final file and note: model values apply to Claude Code subagent dispatch; other hosts (e.g. Codex) resolve models their own way and ignore the tiers.

---

## Routing Targets

- **To INFERNO Orchestrator**: `/specsmd-inferno`

---

## Begin

Activate now. Read the template, then start the questions.
