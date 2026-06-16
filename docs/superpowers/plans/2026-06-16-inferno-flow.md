# INFERNO Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the autonomous/parallel "team" capability as a standalone specsmd flow named **INFERNO**, selected at install time *instead of* FIRE, with its own `.specs-inferno/` namespace, no policy hook, and config-driven planning autonomy.

**Architecture:** Two repos. Source of truth = the upstream clone `/home/ruben/dev/specsmd-upstream` (a clone of `fabriqaai/specs.md`), where a new `src/flows/inferno/` tree is created on a fresh `feat/inferno-flow` branch off `main`, registered in the `FLOWS` registry, and guarded by a drift test. The INFERNO tree is derived mechanically from the existing `feat/fire-team` team trees (`agents/team{,-builder,-planner}/`), renamed to `agents/{orchestrator,builder,planner}/`, with the "team" qualifier dropped and two behavioral gates changed (auto-decompose; config-driven build hand-off). This repo (`/home/ruben/dev/specsmd_new`) holds the evals, the built tarball artifact, and the project docs/cleanup.

**Tech Stack:** Node.js (CJS flow scripts + `node:test` suites), TypeScript + vitest (upstream unit tests), markdownlint, bash eval harnesses driving the installer through a PTY (`script -qec`).

---

## Source-of-truth facts (verified 2026-06-16)

- The upstream `feat/fire-team` team trees are **newer** than this repo's `.specsmd/fire/agents/team*` mirror and are the canonical source. The mirror is stale: it still carries `sync-claude-agent.cjs` (upstream already dropped it) and lacks the `config.example.yaml` upstream has. **Always source from upstream `feat/fire-team`, never from this repo's installed mirror.**
- `main` (upstream) has a clean FIRE flow: `src/flows/fire/agents/` contains only `builder/`, `orchestrator/`, `planner/`. Branching INFERNO off `main` guarantees the FIRE flow stays single-planner (the structural fix for the original bug).
- The installer copies `src/flows/<flow>/agents/` verbatim and copies `src/flows/<flow>/README.md` **unconditionally** (no existence guard) — `src/flows/inferno/README.md` MUST exist or `specsmd install` throws.
- `config.example.yaml` must live **inside** `agents/orchestrator/` so it lands via the unconditional `agents/` copy.
- The flow-selector menu is built from `Object.entries(FLOWS)` in insertion order: `fire, aidlc, simple, ideation`. Appending `inferno` makes it the **5th** option.
- `.claude/settings.json` does not exist in this repo — the skill-policy hook is an unwired file. Cleanup is just deleting the `.py` and updating the prose that mentions it.
- markdownlint (`lint:md` → `flows/**/*.md`) has **no** MD044 proper-names allowlist, so no dictionary to update; only structural lint applies to the new files.

## File structure

**Created (upstream clone, `feat/inferno-flow`):**
- `src/flows/inferno/agents/planner/` — from `agents/team-planner/`
- `src/flows/inferno/agents/builder/` — from `agents/team-builder/`
- `src/flows/inferno/agents/orchestrator/` — from `agents/team/` (incl. `config.example.yaml`)
- `src/flows/inferno/commands/inferno.md`, `inferno-planner.md`, `inferno-builder.md`, `inferno-config.md`
- `src/flows/inferno/README.md`
- `src/__tests__/unit/inferno/inferno-flow.test.ts`

**Modified (upstream clone):**
- `src/lib/constants.js` — add `FLOWS.inferno`
- `src/lib/dashboard/flow-detect.js` — INFERNO awareness (dashboard marker dir)
- `src/package.json` — version bump `0.1.74` → `0.1.75`

**Modified (this repo):**
- `evals/install-eval.sh`, `evals/e2e/{setup-sandbox,run-e2e,assert-e2e}.sh`, `evals/e2e/fixtures/{state.yaml,brief.md}`
- `evals/dist/` — drop `specsmd-0.1.75.tgz`, remove `specsmd-0.1.74.tgz`
- `CLAUDE.md`, `README.md`

**Deleted (this repo):**
- `.claude/hooks/specsmd-skill-policy.py`
- `INSTALL.md`

> **Convention — kept "team" filenames.** The three bundled scripts keep their names: `team-scheduler.cjs`, `team-scheduler.test.cjs`, `team-work-item-contract.test.cjs`. They are internal, referenced from several places (orchestrator agent body, drift test, install eval), and renaming is pure reference-chasing churn with no user-facing benefit. Their *contents* are still transformed (`.specs-fire` → `.specs-inferno`, "team work item" → "work item"). The residual-audit grep in Task 3 explicitly excludes these three filenames.

---

## Task 1: Upstream branch + green baseline

**Files:** none (git + verification only)

- [ ] **Step 1: Create the branch off `main`**

```bash
cd /home/ruben/dev/specsmd-upstream
git fetch -q
git checkout main
git checkout -b feat/inferno-flow
```

- [ ] **Step 2: Confirm the FIRE flow on this branch is single-planner (no team trees)**

Run:
```bash
ls -1 src/flows/fire/agents
```
Expected: exactly `builder`, `orchestrator`, `planner` (no `team*`).

- [ ] **Step 3: Install deps and verify the baseline is green BEFORE adding anything**

```bash
cd /home/ruben/dev/specsmd-upstream/src
npm install
npm run validate:all
```
Expected: vitest + markdownlint + webview-bundle check all pass. If red here, stop and fix the baseline first — do not build on a broken tree.

---

## Task 2: Scaffold the INFERNO agent tree from `feat/fire-team`

**Files:**
- Create: `src/flows/inferno/agents/{planner,builder,orchestrator}/...`

- [ ] **Step 1: Pull the team trees out of `feat/fire-team` into the working tree**

```bash
cd /home/ruben/dev/specsmd-upstream
git checkout feat/fire-team -- \
  src/flows/fire/agents/team \
  src/flows/fire/agents/team-builder \
  src/flows/fire/agents/team-planner
```

- [ ] **Step 2: Relocate them under `src/flows/inferno/agents/` with the renamed roles**

```bash
mkdir -p src/flows/inferno/agents
mv src/flows/fire/agents/team-planner src/flows/inferno/agents/planner
mv src/flows/fire/agents/team-builder src/flows/inferno/agents/builder
mv src/flows/fire/agents/team        src/flows/inferno/agents/orchestrator
git add -A src/flows
```

- [ ] **Step 3: Verify the inferno tree and the untouched FIRE flow**

Run:
```bash
find src/flows/inferno -type f | sort
echo '--- fire flow must be unchanged ---'
ls -1 src/flows/fire/agents
```
Expected — inferno tree (16 files):
```
src/flows/inferno/agents/builder/agent.md
src/flows/inferno/agents/builder/skills/workitem-execute/SKILL.md
src/flows/inferno/agents/orchestrator/agent.md
src/flows/inferno/agents/orchestrator/config.example.yaml
src/flows/inferno/agents/orchestrator/skills/orchestrate/SKILL.md
src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs
src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.test.cjs
src/flows/inferno/agents/orchestrator/skills/orchestrate/templates/intent-selection.md.hbs
src/flows/inferno/agents/planner/agent.md
src/flows/inferno/agents/planner/skills/design-doc-generate/SKILL.md
src/flows/inferno/agents/planner/skills/design-doc-generate/templates/design.md.hbs
src/flows/inferno/agents/planner/skills/intent-capture/SKILL.md
src/flows/inferno/agents/planner/skills/intent-capture/templates/brief.md.hbs
src/flows/inferno/agents/planner/skills/work-item-decompose/SKILL.md
src/flows/inferno/agents/planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs
src/flows/inferno/agents/planner/skills/work-item-decompose/templates/work-item.md.hbs
```
And `ls -1 src/flows/fire/agents` → exactly `builder`, `orchestrator`, `planner`. If any `team*` dir remains under `src/flows/fire/agents`, the relocate failed — fix before continuing (a leftover would re-introduce the two-planner ambiguity in FIRE).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "inferno: scaffold flow tree from feat/fire-team team agents"
```

---

## Task 3: Bulk mechanical transform + residual audit

**Files:**
- Modify: every file under `src/flows/inferno/agents/`
- Create (temporary): `src/flows/inferno/transform.sh` (deleted at end of task)

This is the deterministic bulk rename: command/agent ids, internal agent-tree paths, artifact namespace, branch prefix, and the bounded prose phrases. Two known residuals that need judgment (`/specsmd-fire` init route; bare `specsmd-fire`) are resolved explicitly afterward.

- [ ] **Step 1: Write the transform script**

Create `src/flows/inferno/transform.sh`:

```bash
#!/usr/bin/env bash
# One-shot mechanical transform of the relocated team trees into INFERNO.
# Ordering is load-bearing: suffixed ids before bare ids; specific prose
# before generic. Run once from the upstream src/ dir.
set -euo pipefail
ROOT="flows/inferno/agents"
mapfile -t FILES < <(find "$ROOT" -type f \( -name '*.md' -o -name '*.cjs' -o -name '*.yaml' -o -name '*.hbs' \))

sed -i \
  -e 's/specsmd-fire-team-builder/specsmd-inferno-builder/g' \
  -e 's/specsmd-fire-team-planner/specsmd-inferno-planner/g' \
  -e 's/specsmd-fire-team-config/specsmd-inferno-config/g' \
  -e 's/specsmd-fire-team/specsmd-inferno/g' \
  -e 's/fire-team-builder/inferno-builder/g' \
  -e 's/fire-team-planner/inferno-planner/g' \
  -e 's/fire-team-config/inferno-config/g' \
  -e 's/fire-team/inferno/g' \
  -e 's#agents/team-builder#agents/builder#g' \
  -e 's#agents/team-planner#agents/planner#g' \
  -e 's#agents/team/#agents/orchestrator/#g' \
  -e 's#\.specsmd/fire/#.specsmd/inferno/#g' \
  -e 's/\.specs-fire/.specs-inferno/g' \
  -e 's/fire-intent/inferno-intent/g' \
  -e 's/FIRE (Fast Intent-Run Engineering)/INFERNO/g' \
  -e 's/FIRE Team/INFERNO/g' \
  -e 's/Team Orchestrator/INFERNO Orchestrator/g' \
  -e 's/Team Planner/INFERNO Planner/g' \
  -e 's/Team Builder/INFERNO Builder/g' \
  -e 's/Team-compatible work items/Work items/g' \
  -e 's/team-compatible work items/work items/g' \
  -e 's/team-compatible //g' \
  -e 's/team work items/work items/g' \
  -e 's/team work item/work item/g' \
  -e 's/team builders/builders/g' \
  -e 's/team builder/builder/g' \
  -e 's/the team orchestrator/the orchestrator/g' \
  -e 's/team orchestrator/orchestrator/g' \
  -e 's/team execution/execution/g' \
  -e 's/team run/run/g' \
  -e 's/team flow/flow/g' \
  -e 's/\bFIRE\b/INFERNO/g' \
  "${FILES[@]}"
echo "transform applied to ${#FILES[@]} files"
```

- [ ] **Step 2: Run it**

```bash
cd /home/ruben/dev/specsmd-upstream/src
bash flows/inferno/transform.sh
```
Expected: `transform applied to 16 files`.

- [ ] **Step 3: Resolve the two known `specsmd-fire` residuals in the orchestrator body**

These are not blind swaps — INFERNO has no `/specsmd-fire` entry, so the init route points at the planner instead.

In `src/flows/inferno/agents/orchestrator/agent.md`, replace:
```
  <step n="1">Verify `.specs-inferno/state.yaml` exists. Missing → route to `/specsmd-fire` project initialization and stop.</step>
```
with:
```
  <step n="1">Verify `.specs-inferno/state.yaml` exists. Missing → route to `/specsmd-inferno-planner` to capture an intent and stop.</step>
```

And replace the constraint:
```
  <constraint>NEVER modify existing `specsmd-fire` command, agent, or skill files as part of execution.</constraint>
```
with:
```
  <constraint>NEVER modify existing `specsmd-inferno` command, agent, or skill files as part of execution.</constraint>
```

- [ ] **Step 4: Residual audit — must come back empty**

Run:
```bash
cd /home/ruben/dev/specsmd-upstream/src
grep -rniE 'fire|\bteam\b|team-|FIRE' flows/inferno/agents \
  | grep -vE 'team-scheduler|team-work-item-contract'
```
Expected: **no output.** Any line printed is an unhandled residual — resolve it by hand using the mapping in Step 1 (e.g. a prose "team"→drop, a "FIRE"→"INFERNO", a path→inferno namespace), then re-run until clean. The only legitimate "team" strings left are inside the three kept script filenames (excluded by the grep).

- [ ] **Step 5: Sanity-check the builder body transformed correctly**

Run:
```bash
head -10 flows/inferno/agents/builder/agent.md
```
Expected: title line reads `# INFERNO Builder`; the role sentence reads `**INFERNO Builder Agent** for INFERNO:`; references to `.specs-inferno/` and `specsmd-inferno-builder`. No `fire`/`team` tokens.

- [ ] **Step 6: Remove the transform script and commit**

```bash
rm flows/inferno/transform.sh
git add -A
git commit -m "inferno: mechanical transform of ids, paths, namespace, prose"
```

---

## Task 4: Behavioral gate T1 — capture always auto-decomposes

**Files:**
- Modify: `src/flows/inferno/agents/planner/skills/intent-capture/SKILL.md`

The FIRE team flow asks `Ready to break this into work items? [Y/n]` and only proceeds on `y`. INFERNO removes that prompt and chains straight into decomposition.

- [ ] **Step 1: Read the current (post-transform) Step 6 to confirm exact text**

Run:
```bash
sed -n '95,109p' src/flows/inferno/agents/planner/skills/intent-capture/SKILL.md
```
Expected to show the `<step n="6" title="Transition">` block ending in `Ready to break this into work items? [Y/n]` and a `<check if="response == y"><invoke_skill>work-item-decompose</invoke_skill></check>`.

- [ ] **Step 2: Replace the Step 6 block**

Replace:
```
  <step n="6" title="Transition">
    <output>
      **Intent captured**: "{intent-title}"

      Saved to: .specs-inferno/intents/{intent-id}/brief.md

      ---

      Ready to break this into work items? [Y/n]
    </output>
    <check if="response == y">
      <invoke_skill>work-item-decompose</invoke_skill>
    </check>
  </step>
```
with:
```
  <step n="6" title="Transition">
    <output>
      **Intent captured**: "{intent-title}"

      Saved to: .specs-inferno/intents/{intent-id}/brief.md

      ---

      Decomposing into work items now.
    </output>
    <action critical="true">Immediately invoke the work-item-decompose skill. INFERNO ALWAYS chains capture into decomposition — never ask the user to confirm this transition.</action>
    <invoke_skill>work-item-decompose</invoke_skill>
  </step>
```

- [ ] **Step 3: Verify the prompt is gone**

Run:
```bash
grep -n 'Ready to break this' src/flows/inferno/agents/planner/skills/intent-capture/SKILL.md || echo "OK: no confirmation prompt"
grep -n 'ALWAYS chains capture' src/flows/inferno/agents/planner/skills/intent-capture/SKILL.md
```
Expected: first prints `OK: no confirmation prompt`; second prints the new line.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "inferno: capture auto-chains into work-item decomposition (T1)"
```

---

## Task 5: Behavioral gate T2 — decompose → build is config-driven

**Files:**
- Modify: `src/flows/inferno/agents/planner/agent.md`

The FIRE team flow ends planning with `Route to Team Orchestrator to begin execution? [Y/n]`. INFERNO replaces that prompt with a read of `autonomy.level` from `.specs-inferno/config.yaml`.

- [ ] **Step 1: Read the current (post-transform) `<handoff_format>` block**

Run:
```bash
sed -n '/<handoff_format>/,/<\/handoff_format>/p' src/flows/inferno/agents/planner/agent.md
```
Expected: a block whose summary lists work items and ends `Route to INFERNO Orchestrator to begin execution? [Y/n]`.

- [ ] **Step 2: Replace the whole `<handoff_format>` block**

Replace from `<handoff_format>` through `</handoff_format>` with:
```
<handoff_format>
  When decomposition is complete, read `autonomy.level` from `.specs-inferno/config.yaml` (file or key absent → treat as `review`) and act on it WITHOUT asking the user:

  - `full` → print the summary below, then immediately route into the orchestrator by executing `/specsmd-inferno`. The build starts with no pause.
  - `review` → print the summary below and STOP. The user reviews the work-item plans and starts `/specsmd-inferno` themselves.

  Summary printed in both cases:

  ```
  Planning complete for intent "{intent-title}".

  Work items ready for execution:
  1. {work-item-1} (low)
  2. {work-item-2} (medium)
  3. {work-item-3} (high)

  All work items execute in autopilot mode.
  ```

  NEVER ask "Route to orchestrator? [Y/n]" — the configured autonomy level is the sole decider of whether the build starts automatically.
</handoff_format>
```

- [ ] **Step 3: Verify**

Run:
```bash
grep -n 'to begin execution? \[Y/n\]' src/flows/inferno/agents/planner/agent.md || echo "OK: handoff prompt removed"
grep -n "autonomy.level" src/flows/inferno/agents/planner/agent.md
```
Expected: first prints `OK: handoff prompt removed`; second shows the new `autonomy.level` read.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "inferno: decompose->build hand-off driven by autonomy.level (T2)"
```

---

## Task 6: Add `autonomy.level` to the config template

**Files:**
- Modify: `src/flows/inferno/agents/orchestrator/config.example.yaml`

- [ ] **Step 1: Confirm the header already transformed**

Run:
```bash
sed -n '1,6p' src/flows/inferno/agents/orchestrator/config.example.yaml
```
Expected: header text mentioning `.specs-inferno/config.yaml`, `/specsmd-inferno-config`, and `.specsmd/inferno/agents/orchestrator/agent.md` (no `fire`/`team`). If "FIRE team per-project configuration" still appears, fix it to "INFERNO per-project configuration".

- [ ] **Step 2: Insert the autonomy block immediately after the header comment, before the `models:` block**

Insert this block on the blank line just above `models:`:
```yaml
# Autonomy level for the planning -> build transition (read by the planner).
#   full   - after decomposition, automatically route into the orchestrator and
#            start building, with no pause to review the work items.
#   review - stop after decomposition so you can read the work-item plans, then
#            start /specsmd-inferno yourself.
# Omit or leave unset to behave as `review`.
autonomy:
  level: review        # full | review

```

- [ ] **Step 3: Verify and commit**

Run:
```bash
grep -n 'autonomy:\|level: review' src/flows/inferno/agents/orchestrator/config.example.yaml
```
Expected: both lines present.
```bash
git add -A && git commit -m "inferno: add autonomy.level to config template"
```

---

## Task 7: Author the command files

**Files:**
- Create: `src/flows/inferno/commands/inferno.md`
- Create: `src/flows/inferno/commands/inferno-planner.md`
- Create: `src/flows/inferno/commands/inferno-builder.md`
- Create: `src/flows/inferno/commands/inferno-config.md`

All four are authored fresh (the team commands live under `src/flows/fire/commands/`, not in the relocated `agents/` tree). The "Back to standard FIRE" routing target is dropped from all of them — INFERNO does not know FIRE.

- [ ] **Step 1: Create `src/flows/inferno/commands/inferno.md`**

```markdown
---
description: INFERNO Orchestrator - parallel builder subagents in one intent worktree
---

# Activate INFERNO

**Command**: `/specsmd-inferno`

---

## Activation

You are now the **INFERNO Orchestrator** for specsmd.

**IMMEDIATELY** read and follow:
-> `.specsmd/inferno/agents/orchestrator/agent.md`

It is the complete, self-contained procedure: intent selection menu (never auto-pick), claim-on-select on the default branch, work-item contract validation, one intent worktree, dependency-frontier dispatch of parallel builders, serialized integration, orchestrator-verified finalize. Do not read `.specsmd/inferno/memory-bank.yaml`; the agent definition carries the paths it needs.

---

## Per-Project Config

Optional `.specs-inferno/config.yaml` (model tiers, finalize verification commands, autonomy level). Template: `.specsmd/inferno/agents/orchestrator/config.example.yaml`. Create it interactively with `/specsmd-inferno-config`.

---

## Routing Targets

- **Builders**: dispatched as `specsmd-inferno-builder` subagents by the orchestrator
- **To INFERNO Planner**: `/specsmd-inferno-planner`

---

## Begin

Activate now. Read the agent definition and start orchestrating.
```

- [ ] **Step 2: Create `src/flows/inferno/commands/inferno-planner.md`**

```markdown
---
description: INFERNO Planner Agent - captures intents and decomposes into work items for parallel execution
---

# Activate INFERNO Planner

**Command**: `/specsmd-inferno-planner`

---

## Activation

You are now the **INFERNO Planner Agent** for specsmd.

**IMMEDIATELY** read and adopt the persona from:
-> `.specsmd/inferno/agents/planner/agent.md`

---

## Critical First Steps

1. **Read State**: `.specs-inferno/state.yaml`
2. **Determine Mode**:
   - No active intent -> `intent-capture` skill
   - Intent without work items -> `work-item-decompose` skill
   - High-complexity work item -> `design-doc-generate` skill
   - Ready work items -> route to `/specsmd-inferno`

---

## Planning Priorities

Decompose with this priority order:

1. **Quality first.** Correct, accurately-scoped work items: truthful `ownership.editable`, real `depends_on`, complete context manifests, no circular dependencies. Never falsify ownership or drop a real dependency.
2. **Parallelism a close second.** Where the intent gives you genuine freedom in how to slice it, choose boundaries that let multiple `specsmd-inferno-builder` agents run at once: disjoint `ownership.editable` sets and short `depends_on` chains, so the orchestrator can dispatch a wide frontier in parallel.

Parallelism is won at the slicing stage, by choosing file or module boundaries that do not share editable files. It is never won by misreporting ownership of a fixed slice.

Every work item runs in **autopilot** (no execution checkpoints); review happens at planning time and at the orchestrator's verified finalize. After decomposition the hand-off to the build is governed by `autonomy.level` in `.specs-inferno/config.yaml` (see the planner agent definition).

---

## Your Skills

- **Intent Capture**: `.specsmd/inferno/agents/planner/skills/intent-capture/SKILL.md` -> Capture new intent
- **Work Item Decompose**: `.specsmd/inferno/agents/planner/skills/work-item-decompose/SKILL.md` -> Break into work items
- **Design Doc Generate**: `.specsmd/inferno/agents/planner/skills/design-doc-generate/SKILL.md` -> Create design doc

---

## Routing Targets

- **To INFERNO Orchestrator**: `/specsmd-inferno`

---

## Begin

Activate now. Read your agent definition and start planning.
```

- [ ] **Step 3: Create `src/flows/inferno/commands/inferno-builder.md` — frontmatter + the canonical builder body**

The body after the frontmatter MUST be byte-identical to `src/flows/inferno/agents/builder/agent.md`'s body (everything after that file's own frontmatter). The Task 10 drift test enforces this. Build it programmatically so the bodies cannot drift:

```bash
cd /home/ruben/dev/specsmd-upstream/src
{
  cat <<'FM'
---
name: specsmd-inferno-builder
description: Use when an INFERNO orchestrator assigns exactly one work item with context manifest and editable ownership.
tools: Read, Write, Edit, MultiEdit, Bash, Grep, Glob, TodoWrite
---
FM
  # strip the agent.md frontmatter, emit the body verbatim
  awk 'BEGIN{fm=0} /^---$/{fm++; next} fm>=2{print}' flows/inferno/agents/builder/agent.md
} > flows/inferno/commands/inferno-builder.md
```

Verify the body matches (this is exactly what the drift test checks):
```bash
diff <(awk 'BEGIN{fm=0}/^---$/{fm++;next}fm>=2{print}' flows/inferno/commands/inferno-builder.md) \
     <(awk 'BEGIN{fm=0}/^---$/{fm++;next}fm>=2{print}' flows/inferno/agents/builder/agent.md) \
  && echo "OK bodies identical"
head -9 flows/inferno/commands/inferno-builder.md
```
Expected: `OK bodies identical`; the head shows the new frontmatter then `# INFERNO Builder`.

- [ ] **Step 4: Create `src/flows/inferno/commands/inferno-config.md`**

```markdown
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
```

- [ ] **Step 5: Verify no stray FIRE/team tokens slipped into the commands, then commit**

Run:
```bash
cd /home/ruben/dev/specsmd-upstream/src
grep -rniE 'fire|\bteam\b|sync-claude-agent' flows/inferno/commands || echo "OK: commands clean"
```
Expected: `OK: commands clean`.
```bash
git add -A && git commit -m "inferno: add command surfaces (orchestrator/planner/builder/config)"
```

---

## Task 8: Flow README (required by the installer)

**Files:**
- Create: `src/flows/inferno/README.md`

`installer.js` copies this file unconditionally; if it is missing, `specsmd install` throws.

- [ ] **Step 1: Create `src/flows/inferno/README.md`**

```markdown
# INFERNO Flow

**Autonomous parallel execution.** INFERNO decomposes an intent into work items and runs parallel autopilot builder subagents inside one intent worktree, with dependency-frontier scheduling, file-ownership mutual-exclusion, claim-on-select intent locking, and an orchestrator-verified merge gate.

INFERNO is a standalone specsmd flow — chosen at install time *instead of* FIRE. It has its own `.specs-inferno/` artifact namespace and does not share state with any other flow.

## Surfaces

| Command | Role |
|---|---|
| `/specsmd-inferno` | Orchestrator: selects an intent, runs the parallel build to a verified merge |
| `/specsmd-inferno-planner` | Captures an intent and decomposes it into work items |
| `/specsmd-inferno-builder` | Subagent dispatched by the orchestrator for exactly one work item |
| `/specsmd-inferno-config` | Wizard for the optional `.specs-inferno/config.yaml` |

## What's different from FIRE

- **No friction gates during planning.** Intent capture flows straight into work-item decomposition with no confirmation prompt. Whether decomposition then flows straight into the build is governed by `autonomy.level` in `.specs-inferno/config.yaml` (`full` = auto-build; `review`/unset = stop so you can read the plans).
- **Every work item runs in autopilot.** Review happens at planning time and at the orchestrator's verified finalize, not via per-item checkpoints.

## Per-project config

Optional `.specs-inferno/config.yaml` carries worker model tiers, the finalize verification gate, the autonomy level, and optional budget-halt / knowledge-base settings. See `agents/orchestrator/config.example.yaml` or run `/specsmd-inferno-config`. Every key is optional; without the file the flow runs on host/project defaults.
```

- [ ] **Step 2: Lint the new markdown and commit**

```bash
cd /home/ruben/dev/specsmd-upstream/src
npm run lint:md
```
Expected: pass (no errors for `flows/inferno/**`). If markdownlint flags the README or commands, run `npm run lint:md:fix` and re-check.
```bash
git add -A && git commit -m "inferno: add flow README"
```

---

## Task 9: Register the flow

**Files:**
- Modify: `src/lib/constants.js`
- Modify: `src/lib/dashboard/flow-detect.js`

- [ ] **Step 1: Add the `FLOWS.inferno` entry**

In `src/lib/constants.js`, inside the `FLOWS` object, after the `ideation` entry (so INFERNO is the 5th menu option), add:
```js
    ideation: {
        name: 'Ideation',
        description: 'Creative ideation - Spark → Flame → Forge idea generation and shaping',
        path: 'ideation'
    },
    inferno: {
        name: 'INFERNO',
        description: 'Autonomous parallel execution - decomposes an intent into work items and runs parallel autopilot builders in one worktree',
        path: 'inferno'
    }
```
(Add the comma after the `ideation` closing brace; the `inferno` entry is now the last one.)

- [ ] **Step 2: Make the dashboard flow-detector INFERNO-aware**

In `src/lib/dashboard/flow-detect.js`:

Change:
```js
const SUPPORTED_FLOWS = ['fire', 'aidlc', 'simple'];
```
to:
```js
const SUPPORTED_FLOWS = ['fire', 'aidlc', 'simple', 'inferno'];
```

And in `getFlowMarkerPath`, add an `inferno` case before `default` (its runtime marker dir is `.specs-inferno`):
```js
    case 'simple':
      return path.join(workspacePath, 'specs');
    case 'inferno':
      return path.join(workspacePath, '.specs-inferno');
    default:
      return null;
```

- [ ] **Step 3: Verify the registry parses and lists inferno last**

Run:
```bash
cd /home/ruben/dev/specsmd-upstream/src
node -e "const {FLOWS}=require('./lib/constants'); console.log(Object.keys(FLOWS)); console.log(FLOWS.inferno)"
node -e "const {SUPPORTED_FLOWS,getFlowMarkerPath}=require('./lib/dashboard/flow-detect'); console.log(SUPPORTED_FLOWS); console.log(getFlowMarkerPath('/tmp/x','inferno'))"
```
Expected: keys end with `inferno`; `FLOWS.inferno` prints the object with `path: 'inferno'`; `SUPPORTED_FLOWS` includes `inferno`; marker path is `/tmp/x/.specs-inferno`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "inferno: register flow in FLOWS + dashboard flow-detect"
```

---

## Task 10: Drift test + full validation

**Files:**
- Create: `src/__tests__/unit/inferno/inferno-flow.test.ts`

Mirrors the existing `src/__tests__/unit/fire/team-flow.test.ts` guard for the INFERNO tree, plus two INFERNO invariants (no FIRE namespace leak; `FLOWS.inferno` registered).

- [ ] **Step 1: Write the test**

Create `src/__tests__/unit/inferno/inferno-flow.test.ts`:
```ts
/**
 * Unit tests for the INFERNO flow packaging invariants.
 *
 * Guards:
 * - The `inferno-builder` command body stays byte-identical to the canonical
 *   `builder` agent body. The installer materializes the command into the
 *   user's `.claude/agents/specsmd-inferno-builder.md`, which serves as the
 *   builder subagent's system prompt, so any drift would ship a stale prompt.
 * - The two self-contained flow test scripts keep passing from the packaged
 *   source.
 * - The INFERNO tree never references the FIRE artifact namespace.
 * - The flow is registered in FLOWS.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return (match ? content.slice(match[0].length) : content).trim();
}

describe('inferno flow', () => {
  it('inferno-builder command body is identical to the canonical builder agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-builder.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/builder/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  it.each([
    'agents/orchestrator/skills/orchestrate/scripts/team-scheduler.test.cjs',
    'agents/planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs',
  ])('flow script suite %s passes', (rel) => {
    // throws (and fails the test) on non-zero exit
    execFileSync(process.execPath, [path.join(INFERNO, rel)], { stdio: 'pipe' });
  });

  it('inferno tree never references the FIRE artifact namespace', () => {
    const files = (readdirSync(INFERNO, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((f) => /\.(md|cjs|yaml|yml|hbs)$/.test(f));
    const offenders = files.filter((f) => {
      const c = readFileSync(path.join(INFERNO, f), 'utf8');
      return c.includes('.specs-fire') || c.includes('.specsmd/fire');
    });
    expect(offenders).toEqual([]);
  });

  it('FLOWS registers inferno', () => {
    const constants = readFileSync(path.join(ROOT, 'lib/constants.js'), 'utf8');
    expect(constants).toMatch(/inferno:\s*\{[\s\S]*?path:\s*'inferno'/);
  });
});
```
(`readdirSync(..., { recursive: true })` requires Node 20+, which the upstream toolchain uses.)

- [ ] **Step 2: Run the new test alone, expect PASS**

```bash
cd /home/ruben/dev/specsmd-upstream/src
npx vitest run __tests__/unit/inferno/inferno-flow.test.ts
```
Expected: 4 tests pass (1 builder-body + 2 script-suite + 1 namespace + 1 FLOWS = the `it.each` counts as 2, so 5 assertions / "tests" reported; all green).

- [ ] **Step 3: Run the bundled suites directly from the inferno tree (defense in depth)**

```bash
node flows/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.test.cjs && echo "OK scheduler"
node flows/inferno/agents/planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs && echo "OK contract"
```
Expected: both print their suite output and `OK ...`.

- [ ] **Step 4: Full upstream validation**

```bash
cd /home/ruben/dev/specsmd-upstream/src
npm run validate:all
```
Expected: vitest (incl. the new inferno test and the untouched fire team test) + markdownlint + webview-bundle check all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "inferno: add flow packaging drift test"
```

---

## Task 11: Build the tarball

**Files:**
- Modify: `src/package.json` (version)
- Create (this repo): `evals/dist/specsmd-0.1.75.tgz`
- Delete (this repo): `evals/dist/specsmd-0.1.74.tgz`

- [ ] **Step 1: Bump the upstream package version**

In `src/package.json`, change `"version": "0.1.74"` to `"version": "0.1.75"` (so the inferno-bearing build is distinguishable from upstream's 0.1.74).

- [ ] **Step 2: Re-validate after the bump, then pack**

```bash
cd /home/ruben/dev/specsmd-upstream/src
npm run validate:all
npm pack
ls -1 specsmd-0.1.75.tgz
```
Expected: validation green; `specsmd-0.1.75.tgz` produced in `src/`.

- [ ] **Step 3: Commit the version bump upstream**

```bash
git add -A && git commit -m "inferno: bump version to 0.1.75 for the inferno-bearing build"
```

- [ ] **Step 4: Move the tarball into this repo's eval dist and drop the old one**

```bash
mv /home/ruben/dev/specsmd-upstream/src/specsmd-0.1.75.tgz /home/ruben/dev/specsmd_new/evals/dist/
cd /home/ruben/dev/specsmd_new
git rm evals/dist/specsmd-0.1.74.tgz
git add evals/dist/specsmd-0.1.75.tgz
```
(Commit happens together with the eval-script updates in Task 12.)

---

## Task 12: Update the install eval

**Files:**
- Modify: `evals/install-eval.sh`

The flow selector now needs 4 down-arrows to reach INFERNO (the 5th option), the asserted paths move to the inferno tree, and we add absence checks for any FIRE-team / `.specs-fire` leakage.

- [ ] **Step 1: Update the header comment and PTY keystrokes**

Replace lines 1-4 (the file header comment) so it describes the INFERNO flow, and replace the PTY driver block (currently `{ sleep 12; printf '\r'; sleep 3; printf '\r'; sleep 45; } | \`) with one that selects the 5th flow:

```bash
# Drive the interactive installer in a PTY:
#   Enter      -> confirm pre-selected (detected) tools
#   Down x4    -> move from FIRE (1st) to INFERNO (5th)
#   Enter      -> select INFERNO
{ sleep 12; printf '\r'; sleep 3; printf '\033[B\033[B\033[B\033[B'; sleep 1; printf '\r'; sleep 45; } | \
  SPECSMD_TELEMETRY_DISABLED=1 script -qec "npx -y --package=\"$TARBALL\" specsmd install" /dev/null \
  > install.log 2>&1
```

- [ ] **Step 2: Replace the flow-tree assertions (lines ~29-42) with the inferno tree**

```bash
# Flow tree
req .specsmd/inferno/agents/orchestrator/agent.md
req .specsmd/inferno/agents/orchestrator/config.example.yaml
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/SKILL.md
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/templates/intent-selection.md.hbs
req .specsmd/inferno/agents/builder/agent.md
req .specsmd/inferno/agents/builder/skills/workitem-execute/SKILL.md
req .specsmd/inferno/agents/planner/agent.md
req .specsmd/inferno/agents/planner/skills/work-item-decompose/SKILL.md
req .specsmd/inferno/agents/planner/skills/work-item-decompose/templates/work-item.md.hbs
req .specsmd/inferno/README.md
```

- [ ] **Step 3: Replace the surfaces loop and builder-frontmatter checks (lines ~43-62)**

```bash
# Claude Code + Codex surfaces for all four inferno commands
for n in inferno inferno-planner inferno-builder inferno-config; do
  req ".claude/commands/specsmd-$n.md"
  req ".claude/agents/specsmd-$n.md"
  req ".codex/skills/specsmd-$n/SKILL.md"
done
# The installed builder agent must be the full system prompt with subagent frontmatter
grep -q '^name: specsmd-inferno-builder' "$SANDBOX/.claude/agents/specsmd-inferno-builder.md" \
  && note "OK   builder agent frontmatter (name)" \
  || { note "FAIL builder agent frontmatter (name)"; FAIL=1; }
grep -q 'INFERNO Builder' "$SANDBOX/.claude/agents/specsmd-inferno-builder.md" \
  && note "OK   builder agent carries full body" \
  || { note "FAIL builder agent body missing"; FAIL=1; }
# manifest records the flow
grep -q 'flow: inferno' "$SANDBOX/.specsmd/manifest.yaml" \
  && note "OK   manifest flow: inferno" \
  || { note "FAIL manifest missing flow: inferno"; FAIL=1; }
# Nothing should reference the retired sync script, FIRE-team surfaces, or .specs-fire
if grep -rqs 'sync-claude-agent' "$SANDBOX/.specsmd" "$SANDBOX/.claude"; then
  note "FAIL retired sync-claude-agent still referenced"; FAIL=1
else
  note "OK   no sync-claude-agent references"
fi
if grep -rqs '\.specs-fire' "$SANDBOX/.specsmd"; then
  note "FAIL .specs-fire namespace leaked into installed flow"; FAIL=1
else
  note "OK   no .specs-fire references"
fi
absent .claude/commands/specsmd-fire-team.md
absent .claude/commands/specsmd-fire-team-planner.md
absent .specsmd/fire
```

- [ ] **Step 4: Repath the bundled-suite runs (lines ~64-68)**

```bash
# Flow script suites run from the installed location
( cd "$SANDBOX" && node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.test.cjs ) \
  && note "OK   team-scheduler suite" || { note "FAIL team-scheduler suite"; FAIL=1; }
( cd "$SANDBOX" && node .specsmd/inferno/agents/planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs ) \
  && note "OK   work-item contract suite" || { note "FAIL work-item contract suite"; FAIL=1; }
```

- [ ] **Step 5: Run the install eval against the new tarball**

```bash
cd /home/ruben/dev/specsmd_new
bash evals/install-eval.sh evals/dist/specsmd-0.1.75.tgz
```
Expected: `INSTALL EVAL: PASS`. If the flow selector lands on the wrong flow (a `req` for an inferno path reports `MISS` while `.specsmd/fire` exists), the down-arrow count or timing is off — inspect `install.log` in the printed sandbox, confirm INFERNO is the 5th entry, and adjust the `\033[B` count/sleeps. Keep the sandbox path the script prints for debugging.

- [ ] **Step 6: Commit (with the tarball swap from Task 11)**

```bash
git add -A
git commit -m "evals: install eval drives INFERNO (5th flow) + 0.1.75 tarball"
```

---

## Task 13: Update the e2e smoke harness

**Files:**
- Modify: `evals/e2e/setup-sandbox.sh`, `evals/e2e/run-e2e.sh`, `evals/e2e/assert-e2e.sh`
- Modify: `evals/e2e/fixtures/state.yaml`, `evals/e2e/fixtures/brief.md`

The work-item fixtures (`add-add.md`, `add-mul.md`, `add-calc.md`) contain no FIRE references and need no change. `autonomy.level` is irrelevant to this harness — it drives the orchestrator directly over a pre-seeded intent, never the planner's decompose→build hand-off.

- [ ] **Step 1: `setup-sandbox.sh` — install INFERNO, seed `.specs-inferno/`**

- Header comment: "FIRE team flow" → "INFERNO flow".
- PTY driver block: same change as install-eval Step 1 — `printf '\033[B\033[B\033[B\033[B'; sleep 1; printf '\r'` to select the 5th flow.
- Install sanity check: `test -f .claude/commands/specsmd-fire-team.md` → `test -f .claude/commands/specsmd-inferno.md`.
- Seed paths: every `.specs-fire` → `.specs-inferno` (the `mkdir -p`, the three `cp ... .specs-inferno/...`, and the `.specs-inferno/config.yaml` heredoc).
- Commit messages: "install FIRE team flow" → "install INFERNO flow".

After edits, verify:
```bash
grep -n 'specs-fire\|fire-team\|FIRE team' evals/e2e/setup-sandbox.sh || echo "OK setup clean"
```
Expected: `OK setup clean`.

- [ ] **Step 2: `run-e2e.sh` — invoke the INFERNO orchestrator**

Change:
```bash
claude -p "/specsmd-fire-team toy-math" \
```
to:
```bash
claude -p "/specsmd-inferno toy-math" \
```

- [ ] **Step 3: `assert-e2e.sh` — inferno namespace + branch prefix**

- `.specs-fire/state.yaml` → `.specs-inferno/state.yaml` (lines 18, 19, and the work-item-status loop near line 30).
- Branch checks: `git branch --list 'fire-intent/*'` → `'inferno-intent/*'`; the two messages "fire-intent branch left behind" / "intent branch deleted" stay accurate (reword "fire-intent" → "inferno-intent" in the message text).

After edits, verify:
```bash
grep -n 'specs-fire\|fire-intent' evals/e2e/assert-e2e.sh || echo "OK assert clean"
```
Expected: `OK assert clean`.

- [ ] **Step 4: `fixtures/state.yaml` and `fixtures/brief.md` — cosmetic FIRE→INFERNO**

- `state.yaml`: `description: Toy project for the FIRE team E2E smoke` → `... for the INFERNO E2E smoke`; rename the metadata key `fire_version: "0.1.8"` → `inferno_version: "0.1.8"` (non-functional project metadata; no assertion reads it).
- `brief.md`: replace any "FIRE"/"team" prose with "INFERNO"/neutral wording (the earlier scan found no `fire`/`FIRE` tokens in `brief.md`, so this is likely a no-op — confirm with `grep -ni 'fire\|team' evals/e2e/fixtures/brief.md`).

- [ ] **Step 5: Commit (do NOT run `run-e2e.sh` here — it costs real tokens and is Ruben's to run)**

```bash
git add -A
git commit -m "evals: port e2e smoke harness to INFERNO namespace + command"
```

---

## Task 14: Cleanup (this repo)

**Files:**
- Delete: `.claude/hooks/specsmd-skill-policy.py`, `INSTALL.md`
- Modify: `CLAUDE.md`, `README.md`
- Modify: the `2026-06-12` port docs (superseded banners)

- [ ] **Step 1: Delete the unwired hook and the obsolete INSTALL.md**

```bash
cd /home/ruben/dev/specsmd_new
git rm .claude/hooks/specsmd-skill-policy.py INSTALL.md
```
(There is no `.claude/settings.json` wiring to remove — verified absent.)

- [ ] **Step 2: Rewrite `CLAUDE.md` for INFERNO**

Replace the entire file with INFERNO-centric guidance. The new content must:
- Describe INFERNO as the project's flow (lifecycle: intent → auto-decomposed work items → worktree → parallel autopilot build → orchestrator-verified merge), with its own `.specs-inferno/` namespace.
- State source-of-truth: the upstream clone `/home/ruben/dev/specsmd-upstream`, branch `feat/inferno-flow`; flow sources under `src/flows/inferno/`; build/eval workflow (transform → `validate:all` → `npm pack` → install eval → e2e smoke).
- Keep the **close-your-own-intent** sequence, adapted to `.specs-inferno/` (commit close artifacts on your branch → merge your intent worktree → kill only THIS worktree's processes and tear it down → push). Keep the "never touch another session's worktree" scoping.
- Keep the **per-project config** note pointing at `.specs-inferno/config.yaml` (model tiers, finalize verification, `autonomy.level`, optional halt / knowledge keys) and `agents/orchestrator/config.example.yaml`.
- Keep the **budget-cap halt** note (paths under `.specs-inferno/halt-notes/`).
- **Remove entirely:** the team-planner-default routing rule, the superpowers pairing/denial rules, all `specsmd-skill-policy.py` / hook references, the `/specsmd-fire-team*` command names, the generated-Claude-agent / `sync-claude-agent.cjs` guidance (INFERNO uses the drift test, not a sync script).

Use the elements-of-style:writing-clearly-and-concisely skill if available. After writing, verify no stale references remain:
```bash
grep -niE 'skill-policy|sync-claude-agent|fire-team|team planner|specs-fire' CLAUDE.md || echo "OK CLAUDE.md clean"
```
Expected: `OK CLAUDE.md clean`.

- [ ] **Step 3: Update `README.md`**

- Drop "policy hook" and "INSTALL.md" from the attribution / contents prose (line ~36 lists "the team flow, team planner, halt protocol, policy hook, scripts" — replace with the INFERNO framing: the INFERNO flow, autonomous parallel orchestration, halt protocol, portability work).
- Remove or update any link to `INSTALL.md` (now deleted).

Verify:
```bash
grep -niE 'policy hook|INSTALL\.md|skill-policy' README.md || echo "OK README clean"
```
Expected: `OK README clean`.

- [ ] **Step 4: Mark the 2026-06-12 port docs superseded**

Add a one-line banner to the very top of each of these files:
- `docs/superpowers/specs/2026-06-12-fire-team-upstream-pr-design.md`
- `docs/superpowers/plans/2026-06-12-fire-team-upstream-port.md`
- `docs/superpowers/2026-06-12-fire-team-upstream-pr-description.md`

Banner text:
```markdown
> **SUPERSEDED (2026-06-16)** by `docs/superpowers/specs/2026-06-16-inferno-flow-design.md` and `docs/superpowers/plans/2026-06-16-inferno-flow.md`. INFERNO ships the autonomous/parallel capability as a standalone flow instead of bolting a team track onto FIRE. Kept for history.
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "cleanup: drop skill-policy hook + INSTALL.md; CLAUDE.md/README for INFERNO; supersede 2026-06-12 port docs"
```

---

## Task 15: Final verification gate — then STOP

**Files:** none (verification only)

- [ ] **Step 1: Re-run the install eval end-to-end against the shipped tarball**

```bash
cd /home/ruben/dev/specsmd_new
bash evals/install-eval.sh evals/dist/specsmd-0.1.75.tgz
```
Expected: `INSTALL EVAL: PASS` with every `req` an `OK`, every `absent`/no-leak check `OK`, and both bundled suites `OK`.

- [ ] **Step 2: Confirm the upstream tree is fully green and committed**

```bash
cd /home/ruben/dev/specsmd-upstream/src && npm run validate:all
cd /home/ruben/dev/specsmd-upstream && git status --short && git log --oneline -8
```
Expected: validation green; working tree clean; the inferno commits present on `feat/inferno-flow`.

- [ ] **Step 3: Confirm this repo's working tree is clean and committed**

```bash
cd /home/ruben/dev/specsmd_new && git status --short && git log --oneline -6
```
Expected: clean tree; the eval + cleanup commits present.

- [ ] **Step 4: STOP — hand off to Ruben for personal testing**

**HARD GATE (from `pr-only-after-user-tested.md` and the design spec):** Do **not** open a PR, push to any shared remote, publish the package, or merge to `main` in either repo. Report what was built and the exact commands Ruben can run himself:
- Install into a scratch repo: `npx -y --package=/home/ruben/dev/specsmd_new/evals/dist/specsmd-0.1.75.tgz specsmd install` (select INFERNO) and try `/specsmd-inferno-planner` (confirm capture auto-decomposes) and `/specsmd-inferno` (confirm a real parallel build to verified merge).
- The e2e smoke (costs tokens): `WORK=$(bash evals/e2e/setup-sandbox.sh evals/dist/specsmd-0.1.75.tgz) && bash evals/e2e/run-e2e.sh "$WORK" && bash evals/e2e/assert-e2e.sh "$WORK"`.

Wait for his explicit go-ahead before any publish/PR step.

---

## Self-review

**Spec coverage** (against `2026-06-16-inferno-flow-design.md`):
- §1 Flow registration → Task 9 (FLOWS + flow-detect).
- §2 Flow tree (renamed roles, config.example.yaml inside orchestrator, drop sync script) → Tasks 2, 6, 10. The sync script is dropped structurally: upstream `feat/fire-team` already lacks it, so it never enters the inferno tree (Task 2 sources from there); install eval re-asserts its absence (Task 12).
- §3 Mechanical transforms → Task 3 (script + residual audit) + the two explicit `specsmd-fire` resolutions.
- §4 Commands (builder carries full frontmatter+body) → Task 7.
- §5 Planning autonomy T1 (always auto) / T2 (config-driven) → Tasks 4, 5.
- §6 Config autonomy key + wizard question → Tasks 6, 7.
- §7 Artifact namespace `.specs-inferno/` → enforced by the transform + drift-test invariant (Task 10) + install-eval no-leak check (Task 12).
- §Evals → Tasks 11–13.
- §Quality gates (drift test, repathed suites, validate:all) → Task 10.
- §Cleanup → Task 14.
- §Build workflow (branch off main, green baseline first, STOP for testing) → Tasks 1, 15.

**Placeholder scan:** No TBD/TODO; every code/edit step carries concrete content or an exact command + expected output. The two prose-rewrite steps (CLAUDE.md Task 14.2, README Task 14.3) are specified by required-content checklist + a verifying grep rather than full text, because they are bespoke project docs, not mechanical artifacts.

**Type/name consistency:** `specsmd-inferno{,-planner,-builder,-config}` command ids, `agents/{orchestrator,builder,planner}/` roles, `.specs-inferno/` namespace, `inferno-intent/` branch prefix, `autonomy.level` (`full`|`review`, unset→`review`), and the kept script filenames (`team-scheduler.cjs`, `team-scheduler.test.cjs`, `team-work-item-contract.test.cjs`) are used identically across the transform, commands, drift test, evals, and config. The drift test's builder-body identity is guaranteed by constructing `inferno-builder.md` from `builder/agent.md` programmatically (Task 7.3).
