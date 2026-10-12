---
description: INFERNO Config - create or update .specs-inferno/config.yaml (worker model tiers, delivery mode, finalize verification)
model: claude-sonnet-5-5
effort: high
---

# INFERNO Config

**Command**: `/specsmd-inferno-config`

---

## Purpose

Create or update the optional per-project configuration at `.specs-inferno/config.yaml`, read by the INFERNO orchestrator (`.specsmd/inferno/agents/orchestrator/agent.md`) and planner (`.specsmd/inferno/agents/planner/agent.md`). Every key is optional. An absent file still yields a working flow on host/project defaults.

---

## Procedure

This is a **display-and-confirm** flow, not an interrogation. Show the defaults in
plain language, let the user accept everything at once or adjust the few things
they care about, and keep raw model IDs in the background. Do NOT walk the user
through every key one at a time.

1. Read the annotated template `.specsmd/inferno/agents/orchestrator/config.example.yaml`. If `.specs-inferno/config.yaml` already exists, read it so you display the user's CURRENT values instead of the defaults.
2. **Display the effective settings in plain language**, then ask one question: *"Use these, or adjust?"* Present them roughly like:
   - **Complex work items** (the reasoning-heavy ones) → handled by the strong model at high effort. *(default: `claude-opus-5-5`, high)*
   - **Simple work items** (mechanical: config, docs, small swaps) → handled by the fast model. *(default: `claude-sonnet-5-5`, high)*
   - **After planning** → the planner writes the work items and stops, with no review pause: what the specs leave open comes back as an `oracle:` block and a direct build as a `direct:` block for your builder. The build is a separate step you start later with `/specsmd-inferno`; the planner never starts it.
   - **Delivery** → *autonomous* (build, merge, and close automatically) or *production* (open merge requests for review, per work item into the intent and the whole intent into your base branch). *(default: autonomous)*
   - **Final check before closing** → the project's build + tests. *(propose what you discover from the repo, e.g. `package.json` scripts)*
   - **Skipping a check that cannot be affected** → per command, the paths that make it worth running. *(offer it only when the final check has more than one command; the orchestrator runs an unlisted command every time)*
   - **Preparing a fresh worktree** → commands run once in a new intent worktree, e.g. an install step. *(propose what the repo needs, or none)*
   - **Machine rules for every worker** → lines pasted verbatim into each builder prompt: wrappers, caps, what may not run in parallel. *(offer it, do not invent one)*
   Keep the model IDs parenthetical/secondary: the user reasons about "complex vs simple work", not provider naming.
3. If the user accepts, you're done, write only the non-default keys. If they want to adjust, change only what they name; everything else keeps its default. Map their plain-language choices to keys: complex→`models.strong`, simple→`models.cheap`, delivery→`delivery.mode`, final check→`verification.finalize`, skipping→`verification.finalize_scopes`, fresh worktree→`worktree.bootstrap`, machine rules→`dispatch.constraints`.
4. **If delivery = production (`merge-request`)**, propose the base branch the intent should merge into, either the branch you are currently on or the repo default branch, and let the user confirm or change it. Record it as `delivery.base_branch` (omit it to let the orchestrator propose-and-confirm at finalize instead).
5. Offer the optional extras only if asked: `halt.flag_file` + `halt.wait_script` (budget-halt), `recovery.idle_minutes` (how long a claimed intent's worktree may sit with no process, edit or commit before `select` offers it for recovery, default 60), `knowledge.index` and `real_app.paths` (globs of the helpers and case texts that drive the real app binary, which builders update and the reviewer checks). Skip silently otherwise.
6. Write `.specs-inferno/config.yaml`, preserving any existing keys you did not touch. Keep the file minimal: only keys that differ from the documented defaults. Every key stays optional; `autonomy.level` changes nothing in the planner either way, and an omitted `delivery.mode` behaves as `auto-close`. A `models.writer` key from an older config is ignored, never an error. The planner writes its own work items, so drop it.
7. Show the final file and note: `models` apply only to Claude Code subagent dispatch, `roles` set a role's model and effort at the next install, and Codex uses `.specs-inferno/config.codex.yaml`.

---

## Routing Targets

- **To INFERNO Orchestrator**: `/specsmd-inferno`

---

## Begin

Activate now. Read the template, then start the questions.
