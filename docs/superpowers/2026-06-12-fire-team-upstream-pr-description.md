> **SUPERSEDED (2026-06-16)** by `docs/superpowers/specs/2026-06-16-inferno-flow-design.md` and `docs/superpowers/plans/2026-06-16-inferno-flow.md`. INFERNO ships the autonomous/parallel capability as a standalone flow instead of bolting a team track onto FIRE. Kept for history.

# PR: Add a FIRE "team track" — parallel builder subagents in one intent worktree

> **Status: DRAFT.** Do not open until the change has been personally tested (install + a real `/specsmd-fire-team` run in a live project) and explicitly approved. The body below is ready to paste into the GitHub PR against `fabriqaai/specs.md`.
>
> **Suggested PR title:** `feat(fire): add team track — parallel builders in one intent worktree`
> **Source branch:** `feat/fire-team` → **base:** `main`

---

## Summary

Adds an **additive "team track"** to the FIRE flow: an orchestrator that runs multiple builder subagents in parallel inside a single intent worktree, with dependency-aware dispatch, file-ownership mutual-exclusion, claim-on-select intent locking, and an orchestrator-verified merge gate. It sits **alongside** the existing sequential FIRE track — both operate on `.specs-fire/` — and changes none of the existing flow's behavior.

**Diff shape:** 24 files changed, **+1,991 / -0**. 21 new files; the only 3 existing files touched are docs/config (`CHANGELOG.md`, `src/flows/fire/README.md`, `.markdownlint.yaml`). No installer or runtime code is modified.

## Motivation

The sequential FIRE track builds one work item at a time. For intents that decompose into several independent work items, that leaves parallelism on the table. The team track lets a planner emit work items annotated with dependencies and editable ownership, then an orchestrator dispatches the independent frontier concurrently while coupled items serialize automatically — collapsing wall-clock time without giving up the FIRE artifacts, worktree isolation, or the verified-merge discipline.

## What's included

**Commands** (`src/flows/fire/commands/`)
- `fire-team.md` — orchestrator entry point
- `fire-team-planner.md` — captures intents, decomposes into team-compatible work items
- `fire-team-builder.md` — executes one assigned work item (see installer note below)
- `fire-team-config.md` — setup wizard for the optional per-project config

**Agent trees** (`src/flows/fire/agents/`)
- `team/` — orchestrator: intent selection → claim → worktree → frontier dispatch → serialized integration → finalize. Includes `skills/orchestrate/` with `team-scheduler.cjs` (deterministic dispatch + result validation) and the `intent-selection` template.
- `team-builder/` — executes exactly one assigned work item; dispatched as a subagent by the orchestrator.
- `team-planner/` — intent capture, design-doc generation, and work-item decomposition skills + templates. Team work items add `depends_on`, `context.required`, and `ownership.editable`.

**Config** — `agents/team/config.example.yaml` (worker model tiers, finalize verification commands). Optional; the flow runs on defaults without it.

**Tests**
- `src/__tests__/unit/fire/team-flow.test.ts` — vitest drift guard, validated by `npm run validate:all`.
- `agents/team/skills/orchestrate/scripts/team-scheduler.test.cjs` — scheduler/validation unit suite (`node:test`), bundled in the flow.
- `agents/team-planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs` — work-item contract suite, bundled in the flow.

**Docs** — a "Team Track" section in `src/flows/fire/README.md`; a `CHANGELOG.md` entry under `[Unreleased]`; six FIRE-semantic inline-code terms added to `.markdownlint.yaml` (`config`, `worktree`, `status`, `case`, `resume`, `finalize`).

## How it works

- **One worktree, many builders.** The orchestrator creates a single intent worktree and dispatches builder subagents into it.
- **Dependency-frontier dispatch.** A work item is eligible only when all its `depends_on` are completed, so coupled items serialize with no extra wiring.
- **Ownership mutual-exclusion.** The scheduler refuses to co-dispatch any two items whose `ownership.editable` paths overlap, so parallel builders never touch the same files. The orchestrator detects and recovers a builder that writes outside its declared ownership.
- **Claim-on-select intent locking.** An intent is claimed when picked up, so concurrent sessions don't collide. (The sequential track is claim-unaware — don't run `/specsmd-fire` and `/specsmd-fire-team` on the same intent simultaneously.)
- **Autopilot-only work items.** Builders are parallel subagents and cannot pause for confirm/validate checkpoints; oversight moves to planning time and to the orchestrator's verified finalize. (Complexity low/medium/high is retained — it drives the orchestrator's model tiering.)
- **Verified merge gate.** The orchestrator integrates serially and runs the configured finalize verification before completing the intent.

## Why this is safe to merge (additive, no behavior change)

- **No installer changes.** The team track rides the existing installer mechanics: `installFlow` copies the flow tree allow-list into `.specsmd/fire/`, and each `commands/<name>.md` is generated into the per-tool surfaces (Claude Code commands + agents; Codex skills). That's why `config.example.yaml` is shipped **inside** `agents/team/` — it lands via the existing `agents/` copy rather than needing a new allow-list entry.
- **No runtime changes.** Nothing in the existing sequential flow is edited. The three modified files are docs/config only.
- **Drift guarded by a test, not a sync script.** The installed builder agent must equal the canonical builder body; this is enforced by `team-flow.test.ts` (part of `validate:all`) rather than a generation script.
- **CHANGELOG under `[Unreleased]`.** No version bump — release/versioning stays the maintainers' call.

### Installer note (one intentional deviation)

Upstream command files are thin routers carrying only `description:` frontmatter. `fire-team-builder.md` is the lone exception: it carries `name:`/`tools:` frontmatter and the full builder body, so that the generated `.claude/agents/specsmd-fire-team-builder.md` works directly as a subagent system prompt when the orchestrator dispatches it.

## Testing done

- **`cd src && npm run validate:all` → green:** 419 tests across 33 files, markdownlint clean, webview bundle in sync.
- **Out-of-tree install eval (deterministic):** packed the tarball, installed it into a fresh sandbox with Claude Code **and** Codex selected, and asserted — all four team commands present as Claude commands + agents and Codex skills; the full flow tree present; the upstream baseline (`orchestrator`, `memory-bank.yaml`) untouched; the builder agent installed with `name:` frontmatter + full body; no stale `sync-claude-agent` references; and the two bundled suites passing **from the installed location** (`team-scheduler` 8/8, work-item contract 3/3).
- **Out-of-tree E2E smoke (real run):** drove `/specsmd-fire-team` over a seeded 3-work-item intent (`add` / `mul` / `calc`, with a dependency) against a live model, then asserted the end state — all six deliverables merged to `main`, `npm test` green on the integrated tree, intent and all work items marked `completed`, the worktree torn down and the intent branch deleted, and `main == origin/main`. The orchestrator's recovery path was also exercised: one builder wrote a file outside its worktree and returned `ready`; the orchestrator detected the malformed location, recovered the file, re-verified, and merged.

## Out of scope (possible follow-ups)

- A skill-policy enforcement hook (separate PR; upstream ships no `settings.json`/hook machinery today).
- Any `INSTALL.md` / packaging docs beyond the flow README + CHANGELOG.

## Contributor checklist

- [ ] `npm run validate:all` passes locally
- [ ] CHANGELOG entry added under `[Unreleased]`
- [ ] No changes to existing flow behavior (additive only)
- [ ] Manually installed the packed tarball and ran a real `/specsmd-fire-team` intent end-to-end

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
