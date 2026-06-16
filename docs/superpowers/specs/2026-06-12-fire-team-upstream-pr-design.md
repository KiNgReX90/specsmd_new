> **SUPERSEDED (2026-06-16)** by `docs/superpowers/specs/2026-06-16-inferno-flow-design.md` and `docs/superpowers/plans/2026-06-16-inferno-flow.md`. INFERNO ships the autonomous/parallel capability as a standalone flow instead of bolting a team track onto FIRE. Kept for history.

# Design: Contributing the FIRE Team Flow Upstream

**Date:** 2026-06-12
**Status:** Approved by Ruben (pending spec review)
**Goal:** Add the specsmd FIRE **team flow** (this repo's core feature) to the upstream
[fabriqaai/specs.md](https://github.com/fabriqaai/specs.md) project as a purely additive
feature, validated end to end via a locally built npx tarball and evals **before** any PR
is opened.

## Hard gate

**No PR is opened, and nothing is published, until Ruben has personally tested the fork
and given explicit go-ahead.** The automated flow ends at "evals pass + fork branch ready
+ tarball available"; opening the PR is a separate, manual, user-triggered step.

## Background

- This repo (`specsmd_new`) holds the team flow in **installed form**: `.specsmd/fire/agents/team*`,
  hand-written `.claude/` commands/agents, a policy hook, and `.codex/` skills. Baseline was
  upstream v0.1.65.
- Upstream is the **installer**: the npm package `specsmd` lives in the repo's `src/` folder
  (currently v0.1.74). Flow sources live at `src/flows/fire/`; `npx specsmd install` copies
  `src/flows/fire/` → `.specsmd/fire/` and generates per-tool surfaces from
  `src/flows/fire/commands/*.md`:
  - **Claude Code**: each command file is copied to `.claude/commands/` AND `.claude/agents/`,
    auto-prefixed `specsmd-` (ClaudeInstaller).
  - **Codex**: each command file is converted to `.codex/skills/specsmd-<name>/SKILL.md`
    (CodexInstaller). No separate Codex porting is needed.
  - Upstream has **no hook / settings.json machinery**.
- Upstream command files are thin routers: frontmatter `description`, "adopt persona from
  `.specsmd/fire/agents/<x>/agent.md`", skills list, routing targets.

## Scope decisions (agreed)

| Decision | Outcome |
|----------|---------|
| PR shape | Purely additive team flow inside the existing FIRE flow, following upstream construction. No installer code changes. |
| INSTALL.md | Personal fix — stays in this repo, not pushed upstream. |
| Skill-policy hook + superpowers wiring | **Out** of this PR (hook possibly a separate later PR). Superpowers references stripped during the port. |
| Model configuration | `.specs-fire/config.yaml` (file) **plus** a new `/specsmd-fire-team-config` setup command that writes it. |
| sync-claude-agent.cjs mechanism | Dropped upstream — agent files are generated from commands by the installer; model selection moves fully to config.yaml read at dispatch time. |
| Budget-halt protocol | Stays — config-gated, inert without halt config. |
| Translation approach | Direct port by hand in a fork (`feat/fire-team` branch); per-file conformance to current upstream idiom. |
| Test channel | Local tarball (`npm pack` in fork's `src/`); optional scoped npm publish only later if ever needed. |
| Eval depth | Deterministic install checks + one E2E smoke scenario. |
| Eval harness location | This repo, under `evals/` — never part of the PR. |
| Execution mode | Team work items always run in **autopilot** (0 checkpoints). The sequential FIRE flow's confirm/validate modes don't apply: builders are parallel subagents and cannot pause for user checkpoints mid-run. The team planner always assigns autopilot, and the team builder ignores/overrides any confirm or validate marking on a work item. |

## 1. PR contents (fork branch `feat/fire-team`)

All additions, no modifications to existing flow behavior:

- **Agent trees** — `src/flows/fire/agents/{team,team-builder,team-planner}/`, ported from
  this repo's `.specsmd/fire/agents/*`. Internal `.specsmd/fire/...` path references already
  match the installed layout and stay unchanged. Superpowers pairings and machine-specific
  wording removed.
- **Commands** — four thin routers in `src/flows/fire/commands/`, in upstream's exact style:
  - `fire-team.md` → installed as `/specsmd-fire-team` (team orchestrator)
  - `fire-team-planner.md` → `/specsmd-fire-team-planner`
  - `fire-team-builder.md` → `/specsmd-fire-team-builder`
  - `fire-team-config.md` → `/specsmd-fire-team-config` — interactively collects
    `models.strong` / `models.cheap` and `verification.finalize` commands, writes
    `.specs-fire/config.yaml` from the shipped example. Documents that model values apply to
    Claude agent dispatch; Codex resolves models its own way, as with the rest of FIRE.
- **Config template** — `config.example.yaml` ships at
  `src/flows/fire/agents/team/config.example.yaml` (the installer copies a fixed allow-list
  of flow subpaths, and `agents/` is the one that always travels), installed as
  `.specsmd/fire/agents/team/config.example.yaml`; the config command copies it to
  `.specs-fire/config.yaml` and fills it in. Agent-doc references to
  `.specs-fire/config.example.yaml` are updated to the new location during the port.
- **Drift test** — a vitest test in `src/__tests__/unit/fire/` replaces the
  `sync-claude-agent.cjs` mechanism: it asserts the `fire-team-builder.md` command body
  equals the canonical `agents/team-builder/agent.md` body (the installer materializes the
  command into `.claude/agents/specsmd-fire-team-builder.md`, preserving the
  full-system-prompt design), and runs the flow's bundled `.cjs` test scripts.
- **Docs** — team-flow section added to `src/flows/fire/README.md`; CHANGELOG entry.
- **Attribution** — PR description credits Rubèn Plantinga (@KiNgReX90); both sides MIT.

Explicitly **not** in the PR: INSTALL.md, `specsmd-skill-policy.py`, superpowers references,
`sync-claude-agent.cjs`, this repo's README/LICENSE/CLAUDE.md, the `evals/` harness,
and this repo's `.claude/scripts/*.cjs` utilities (fact-check 2026-06-12: nothing in the
team flow references them — they are personal helpers synced from another project).
`src/flows/fire/memory-bank.yaml` also stays untouched: it has no agent registry, and the
team flow explicitly never reads it; the flow README documents the team track instead.

## 2. Fork mechanics & drift

- Fork `fabriqaai/specs.md` under @KiNgReX90, branch `feat/fire-team` off current main.
- Baseline drift (0.1.65 → 0.1.74, ~9 releases): during the port, each file is checked
  against the *current* upstream planner/builder/orchestrator conventions and adjusted.
- Upstream's own quality gate must pass in the fork: `npm run validate:all` in `src/`
  (vitest suite + markdownlint over `flows/**/*.md`). Markdownlint runs early in the port,
  not at the end.

## 3. Test pipeline (in this repo, under `evals/`)

1. **Build**: `cd <fork>/src && npm pack` → `specsmd-<version>.tgz`.
2. **Deterministic install checks** (scripted): for each of {Claude Code, Codex}:
   - fresh temp dir, `git init`, run `npx <tarball> install` selecting the FIRE flow and the
     tool (answers piped, or CLI flags if available);
   - assert: four `specsmd-fire-team*` commands and agents present (Claude) / four generated
     `SKILL.md`s (Codex); `.specsmd/fire/agents/team*` trees complete; config example present;
   - run the bundled test scripts from the installed location: team-scheduler test,
     work-item contract test, intent-worktree test.
3. **E2E smoke** (one scenario, Claude Code headless in an installed sandbox repo):
   - toy intent with 3 work items including one `depends_on` chain, captured via the team
     planner, then executed via `/specsmd-fire-team`;
   - verify: work items carry team fields (`depends_on`, `context.required`,
     `ownership.editable`); intent worktree created; builders dispatched; `state.yaml`
     reaches done; merge to default branch happened; worktree torn down.
4. **Handoff**: eval results + tarball + fork branch presented to Ruben for personal testing.
   **Stop here** (see hard gate).

## 4. Error handling & risks

- **Interactive installer**: upstream CLI uses `prompts`; eval script pipes answers or uses
  flags. If automation proves brittle, fall back to documenting a manual install-check
  checklist — the E2E smoke still validates the result.
- **Markdownlint strictness**: ported docs may need formatting fixes; run lint per file
  during porting.
- **Drift surprises**: if upstream changed FIRE schemas (state.yaml, memory-bank.yaml) since
  0.1.65, the port adapts to upstream's current schema — upstream wins on conventions.
- **E2E flakiness**: agent-driven smoke runs are non-deterministic; the eval records the
  transcript and artifacts so failures are diagnosable rather than just red.

## 5. Order of work

1. Fork + branch.
2. Port agent trees, commands, config template, scripts; strip superpowers; lint clean.
3. Registry (memory-bank.yaml), flow README, CHANGELOG.
4. `npm run validate:all` green in fork.
5. Build tarball; run deterministic install evals.
6. Run E2E smoke; iterate until green.
7. Hand everything to Ruben for personal testing. **PR only on his explicit go.**
