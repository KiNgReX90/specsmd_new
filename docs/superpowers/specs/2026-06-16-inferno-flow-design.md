# INFERNO — a standalone autonomous SDLC flow

> **Status: DESIGN, approved 2026-06-16.** Supersedes the earlier
> "FIRE team flow upstream port" approach
> (`2026-06-12-fire-team-upstream-pr-design.md` and its plan / PR draft),
> which bolted the team track *onto* the FIRE flow. INFERNO instead ships the
> autonomous/parallel capability as its own top-level flow.
>
> **Hard gate:** no PR, push, or publish without Ruben's explicit go-ahead
> after he has personally tested the install and a real `/specsmd-inferno` run.

## Goal

Ship the parallel-autonomous "team" capability as a **separate specsmd flow
named INFERNO**, selected at install time *instead of* FIRE. INFERNO is FIRE's
structure (planner → builder → orchestrator) with two deliberate differences:

1. **Autonomous parallel execution.** Work items carry `depends_on`,
   `ownership.editable`, and `context.required`; an orchestrator dispatches
   parallel autopilot builders into one intent worktree with
   dependency-frontier scheduling, ownership mutual-exclusion, claim-on-select
   intent locking, and a verified merge gate.
2. **No friction gates during planning.** Intent capture flows straight into
   work-item decomposition with no confirmation prompt, and a config-driven
   autonomy level decides whether decomposition then flows straight into the
   build.

INFERNO is **fully decoupled from FIRE**: its own flow tree, its own
`.specs-inferno/` artifact namespace, its own commands. The two flows are
mutually exclusive at install time and never share state. There is **no policy
hook** — a standalone flow ships exactly one planner, so the old
"which planner did the model pick?" mis-routing cannot occur.

## Why this replaces the FIRE-team port

The original plan added `fire-team*` commands and `agents/team*` trees *into*
the `fire` flow. After a plain `specsmd install` of FIRE, the host then had
**two** planners (`/specsmd-fire-planner` and `/specsmd-fire-team-planner`) with
no installed hook to disambiguate them, so cold "capture an intent" defaulted to
the regular planner — the reported bug. Making INFERNO its own flow removes the
ambiguity structurally and drops the entire hook/settings.json enforcement layer
that the additive port could never ship through the installer anyway.

## Background — the install machinery (verified 2026-06-16)

- **Source of truth is the upstream clone.** The installable package is the
  `fabriqaai/specs.md` repo, cloned at `/home/ruben/dev/specsmd-upstream`
  (currently branch `feat/fire-team`, package version `0.1.74`). Flow definitions
  live under `src/flows/<flow>/`. This repo (`specsmd_new`) holds the team flow
  only in *installed* form plus the evals and the built tarball artifact.
- **Flow registry.** `src/lib/constants.js` exports `FLOWS` — an object keyed by
  flow id (`fire`, `aidlc`, `simple`, `ideation`), each `{ name, description,
  path }`. `src/lib/installer.js` builds the "Which SDLC flow…" menu from
  `Object.entries(FLOWS)` (insertion order), so a new entry appears as an extra
  menu option with no other installer change.
- **`installFlow(flowKey, toolKeys)`:**
  - Per selected tool, calls `installer.installCommands(flowPath, …)` to generate
    per-tool surfaces from `src/flows/<flow>/commands/*.md`. `ClaudeInstaller`
    writes each `commands/<name>.md` to BOTH `.claude/commands/specsmd-<name>.md`
    and `.claude/agents/specsmd-<name>.md` (verbatim). `CodexInstaller` writes
    `.codex/skills/specsmd-<name>/SKILL.md`.
  - Copies the flow resources into `targetFlowDir = .specsmd/<flowKey>`:
    `agents/` (always) plus, if present, `agent-capabilities/`, `bolt-types/`,
    `skills/`, `templates/`, `shared/`, `scripts/`, `memory-bank.yaml`,
    `context-config.yaml`, `quick-start.md`, `constitution.md`.
  - **`README.md` at the flow root is copied UNCONDITIONALLY** (no existence
    guard) — `src/flows/inferno/README.md` MUST exist or the install throws.
  - Writes `.specsmd/manifest.yaml` with `flow: <flowKey>`.
- **`.specs-<flow>/` is a runtime artifact dir**, created by the flow's agents at
  run time (state, intents, runs, config), NOT by the installer. FIRE uses
  `.specs-fire/`; INFERNO will use `.specs-inferno/`.
- **No hook/settings.json machinery exists upstream.** The skill-policy hook is
  out of scope and is deleted from this repo (see Cleanup).

## Design

### 1. Flow registration

Add one entry to `FLOWS` in `src/lib/constants.js`:

```js
inferno: {
    name: 'INFERNO',
    description: 'Autonomous parallel execution - decomposes an intent into ' +
                 'work items and runs parallel autopilot builders in one worktree',
    path: 'inferno'
}
```

Audit secondary flow enumerations for INFERNO awareness — at minimum
`src/lib/dashboard/flow-detect.js` (any place that maps a manifest `flow` id to
a name/detection). Add INFERNO where flows are enumerated; no behavior change to
existing flows.

### 2. Flow tree (`src/flows/inferno/`)

Derived from this repo's team trees
(`.specsmd/fire/agents/team{,-builder,-planner}/`), with the "team" qualifier
dropped because the entire flow is the autonomous one:

| INFERNO path | Source | Contents |
|---|---|---|
| `agents/planner/` | `team-planner/` | `agent.md` + skills `intent-capture/`, `work-item-decompose/`, `design-doc-generate/` (+ their templates) |
| `agents/builder/` | `team-builder/` | `agent.md` + skill `workitem-execute/` |
| `agents/orchestrator/` | `team/` | `agent.md` + skill `orchestrate/` (incl. `scripts/` scheduler + test, `templates/intent-selection.md.hbs`) + `config.example.yaml` |
| `README.md` | new | flow overview (REQUIRED by the installer) |

The `config.example.yaml` stays **inside `agents/orchestrator/`** so it lands via
the unconditional `agents/` copy (same reason it lived in `agents/team/` for the
port).

Drop the `sync-claude-agent.cjs` generation mechanism entirely; the installed
builder agent is guarded by a drift test instead (see Quality gates).

### 3. Mechanical transforms applied to every ported file

- `.specsmd/fire/` → `.specsmd/inferno/`
- `.specs-fire/` → `.specs-inferno/`
- command/agent ids: `specsmd-fire-team` → `specsmd-inferno`,
  `specsmd-fire-team-planner` → `specsmd-inferno-planner`,
  `specsmd-fire-team-builder` → `specsmd-inferno-builder`,
  `specsmd-fire-team-config` → `specsmd-inferno-config`
- slash routes: `/specsmd-fire-team*` → `/specsmd-inferno*`; any "back to
  `/specsmd-fire`" routing target is **removed** (INFERNO does not know FIRE)
- prose: "FIRE Team" / "Team Planner/Builder/Orchestrator" → "INFERNO" /
  "INFERNO Planner/Builder/Orchestrator"; "team work item" → "work item"
- agent-tree internal references to sibling agents updated to the new
  `agents/{planner,builder,orchestrator}/` names

### 4. Commands (`src/flows/inferno/commands/`)

| File | Installed as | Role |
|---|---|---|
| `inferno.md` | `specsmd-inferno` | orchestrator entry |
| `inferno-planner.md` | `specsmd-inferno-planner` | intent capture + decomposition + design docs |
| `inferno-builder.md` | `specsmd-inferno-builder` | one work item; **carries full `name:`/`tools:` frontmatter + full builder body** so the generated `.claude/agents/specsmd-inferno-builder.md` works directly as a subagent system prompt |
| `inferno-config.md` | `specsmd-inferno-config` | config wizard writing `.specs-inferno/config.yaml` |

All other command files are thin routers carrying only `description:`
frontmatter (upstream style); `inferno-builder.md` is the single intentional
deviation.

### 5. Planning autonomy — the behavioral differences from FIRE

Two transition points in the planner:

- **T1 — capture → decompose: ALWAYS automatic.** In
  `agents/planner/skills/intent-capture/SKILL.md`, Step 6 ("Transition")
  currently asks `Ready to break this into team-compatible work items? [Y/n]`
  and only proceeds on `y`. In INFERNO this prompt is removed: once the intent
  brief is saved and `state.yaml` is updated, the skill **immediately invokes
  `work-item-decompose`**. (Kept: Step 3's "Is this accurate? [Y/n/edit]"
  summary check and all clarifying questions — those confirm understanding, not
  friction.)
- **T2 — decompose → build: config-driven.** After decomposition, behavior is
  governed by `autonomy.level` in `.specs-inferno/config.yaml`:
  - `full` → the planner **auto-routes into the orchestrator** (`/specsmd-inferno`)
    and the build starts with no prompt.
  - `review` (and the unset default) → the planner **presents the work items and
    stops**; the user reviews the plans and starts `/specsmd-inferno` themselves.

  The `<handoff_format>` gate in `agents/planner/agent.md`
  (`Route to … to begin execution? [Y/n]`) is replaced by this config read.

### 6. Config (`.specs-inferno/config.yaml`)

Carries forward the team config keys (`models.strong`/`cheap`,
`verification.finalize`, optional `halt.*`, optional `knowledge.index`) with the
path reference updated to `.specs-inferno/`, plus the new autonomy key:

```yaml
# Autonomy level for the planning → build transition.
#   full   - after decomposition, automatically route into the orchestrator and
#            start building (no pause to review the work items).
#   review - stop after decomposition so you can read the work-item plans, then
#            start /specsmd-inferno yourself.
# Unset behaves as `review`.
autonomy:
  level: review        # full | review
```

The `inferno-config` wizard (`commands/inferno-config.md`) asks one additional
question — *"Run INFERNO fully autonomously (decompose → build with no review),
or pause after decomposition to review the plans?"* — and writes
`autonomy.level`. The `finalize` verification commands it proposes must reference
the INFERNO sync-free model (no `sync-claude-agent.cjs --check` line).

### 7. Artifact namespace

All INFERNO runtime artifacts live under `.specs-inferno/`:
`state.yaml`, `config.yaml`, `intents/<id>/{brief.md,work-items/…}`, run logs,
`halt-notes/` (if halt configured). Nothing reads or writes `.specs-fire/`.

## Evals (this repo)

- **`evals/install-eval.sh`** — drive the flow selector to **INFERNO** (now the
  5th menu option: send the requisite down-arrow keystrokes before Enter rather
  than the plain Enter that selects FIRE). Assert:
  - `.specsmd/inferno/agents/{planner,builder,orchestrator}/…` present, incl.
    `agents/orchestrator/config.example.yaml`, the orchestrate scripts, and the
    `README.md`.
  - `specsmd-inferno{,-planner,-builder,-config}` exist as `.claude/commands/*`,
    `.claude/agents/*`, and `.codex/skills/*/SKILL.md`.
  - `.claude/agents/specsmd-inferno-builder.md` carries the full builder body +
    `name:` frontmatter.
  - `.specsmd/manifest.yaml` records `flow: inferno`.
  - **Absence** of any `fire-team*` surface, `.specs-fire` reference, and the
    retired `sync-claude-agent.cjs`.
  - Bundled flow script suites pass from the installed location (scheduler test;
    work-item contract test).
- **`evals/e2e/`** — update fixtures (`state.yaml`, briefs, work items) and
  `assert-e2e.sh` to INFERNO naming and `.specs-inferno/`.
- Rebuild the tarball from the upstream clone (`cd src && npm pack`), drop it in
  `evals/dist/`, and update the version the eval scripts reference.

## Quality gates (upstream clone)

- New drift test `src/__tests__/unit/inferno/inferno-flow.test.ts` (mirrors the
  team-flow drift guard): the canonical builder body equals the body shipped via
  `commands/inferno-builder.md`; key INFERNO invariants (no `.specs-fire`
  references in the inferno tree, autopilot-only work items, the `FLOWS.inferno`
  entry) hold. Part of `npm run validate:all`.
- The bundled `node:test` suites (scheduler, work-item contract) are repathed
  under the inferno tree and still pass standalone.
- `cd src && npm run validate:all` green: vitest + markdownlint
  (`.markdownlint.yaml` — add any INFERNO inline-code terms it flags) +
  webview-bundle check.

## Cleanup (this repo)

- **Delete** `.claude/hooks/specsmd-skill-policy.py` (no longer part of the
  design) and remove any settings.json wiring docs that referenced it.
- **Delete** `INSTALL.md` (the manual-overlay path is obsolete; install is the
  `specsmd install` CLI).
- **Rewrite** `CLAUDE.md`: drop the team-planner default, the superpowers
  pairing/denial rules, the hook references, and the generated-agent/sync-script
  guidance. Replace with INFERNO development guidance (source-of-truth in the
  upstream clone, build/eval workflow, the close-intent sequence adapted to
  `.specs-inferno/`).
- Mark the `2026-06-12` port spec/plan and the PR draft as **superseded** by this
  spec (a one-line banner at their top), or remove them.

## Build workflow

1. In `/home/ruben/dev/specsmd-upstream`, branch `feat/inferno-flow` off `main`
   (do not build on `feat/fire-team`; the additive-into-FIRE changes are not used).
2. Verify the upstream baseline is green (`cd src && npm install && npm run
   validate:all`) before adding anything.
3. Create `src/flows/inferno/` (tree + commands + README), add the `FLOWS` entry,
   apply the transforms, add the drift test, run `validate:all`.
4. Back in this repo: update the evals, rebuild + drop the tarball, run the
   install eval and the e2e smoke, do the cleanup.
5. **STOP** for Ruben's personal testing. No PR, push, or publish.

## Out of scope / deferred

- Upstreaming INFERNO to `fabriqaai/specs.md` as a public flow (maintainers may
  resist a near-duplicate of FIRE). INFERNO is Ruben's own flow, installed from
  his local build, until he decides otherwise.
- Any change to the FIRE flow's behavior.
- A per-intent "team vs solo" ask (obsolete — the choice is the flow you install).
