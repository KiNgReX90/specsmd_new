---
id: inception-to-inferno-bridge
title: Inception→INFERNO converter + lean inception mode
status: pending
created: 2026-06-23T00:00:00Z
---

# Intent: Inception→INFERNO converter + lean inception mode

## Goal

Build the two flow-source changes that let AI-DLC inception output drive a
parallel INFERNO build with NO units/bolts construction layer:

1. **The converter** — a `/inception-to-inferno` command + planner skill that
   reads a completed AI-DLC memory-bank intent and emits an INFERNO intent
   brief + contract-valid work items into `.specs-inferno/`. User stories
   survive as work items *linked* to their story file (never re-summarized);
   units become `ownership.editable` partitions + a grouping label; bolts and
   unit-brief construction docs are discarded.
2. **Lean inception mode** — a mode of the inception agent that stops after
   stories (skips bolt-plan, authors only minimal unit grouping instead of
   verbose unit-brief docs), producing exactly the artifacts the converter
   consumes and nothing more.

This is Phase 1 + Phase 2 of the strategy in
`docs/inception-to-inferno-eval-strategy.md`. It is the keystone the eval
harness (Phases 3–6, separate intent) depends on: the converter feeds arms
A2 (full inception → bridge) and A4 (lean inception → bridge), and lean mode
is what makes A4 — the shippable target end-state — possible.

This intent modifies FLOW SOURCES only: `src/flows/inferno/` (converter) and
`src/flows/aidlc/` (lean mode). The eval-harness fixtures, runner, and judges
are a later, separate intent.

## Users

- The flow maintainer (Ruben), who runs inception on ViewPoint and wants the
  ~37-doc inception output to collapse into a flat set of INFERNO work items
  that build in parallel without the units/bolts/stage doc explosion.
- Any developer running the inception→INFERNO pipeline:
  `/inception-discovery → /specsmd-inception-agent → /resolve-inception-docs →
  /inception-to-inferno → /specsmd-inferno`.

## Problem

1. **No bridge exists.** Inception (AI-DLC) and INFERNO share no state. Today
   the only way from inception output to a build is the AI-DLC construction
   flow (units → bolts → DDD docs), which is the doc-bloat we want to kill.
   There is no path from a finished inception intent into `.specs-inferno/`.
2. **Inception always authors the heavy layer.** Even if a converter ignores
   units/bolts, full inception still WRITES unit-brief docs and a bolt-plan
   first — wasted planning-side tokens and docs. There is no way to stop
   inception after stories.
3. **Contract gap.** INFERNO work items must pass a hard validator
   (`team-scheduler.cjs`): non-empty `context.required` + `ownership.editable`,
   `context.patterns` for behavior/architecture/api/ui, `context.tests` unless
   docs/config-only. Inception stories are prose with no concrete editable
   targets, so a naive map produces invalid work items.

## Success Criteria

- A `/inception-to-inferno` command exists and, given a completed memory-bank
  intent, writes `.specs-inferno/intents/{id}/brief.md` + one
  `work-items/{story-id}.md` per story, plus the `state.yaml` entry.
- Mapping rules hold: requirements + system-context → brief; each story → one
  work item whose `context.required` LINKS the story file (no re-summary);
  story Requires/Depends → work-item `depends_on`; units → `ownership.editable`
  partition + a grouping label; bolts + unit-brief docs discarded.
- Every emitted work item passes the `team-scheduler.cjs` validator. Concrete
  `ownership.editable` / `context.patterns` / `context.tests` paths are
  resolved against the real (brownfield) codebase, preferring any paths already
  pinned in story frontmatter by `/resolve-inception-docs`. Any story that
  cannot be resolved to a real editable target is FLAGGED and NOT emitted —
  never emitted invalid.
- The mechanical extraction (memory-bank intent → structured story/unit list →
  work-item skeletons) is implemented as a testable unit, covered by a Vitest
  fixture test that asserts the emitted skeletons pass the validator.
- Lean inception mode runs requirements → system-context → (lean) units →
  stories then STOPS: no bolt-plan authored, no verbose unit-brief docs — only
  the minimal unit grouping the converter needs. Selectable without breaking
  the existing full pipeline.
- `cd src && npm run validate:all` passes, including the FIRE-namespace and
  command↔agent drift guards over every new/edited file.

## Constraints

- Edit only `src/flows/inferno/` and `src/flows/aidlc/` sources (+ their
  in-`src` tests). Flow files stay project- and host-neutral: no hardcoded
  model IDs, branch names, forge, or ViewPoint-specific paths.
- Preserve INFERNO invariants: the INFERNO tree never references the FIRE
  namespace; any new command body stays in sync with its agent/skill per the
  drift guard; builders never edit `state.yaml`.
- The converter REUSES the existing work-item template and the planner's
  scribe/writer fan-out; it does not fork a parallel authoring path.
- Lean mode is additive — the full inception pipeline (units + bolt-plan)
  must still work unchanged when lean mode is off.

## Notes

Design decisions carried from the strategy doc + this planning pass:

- **Converter lives in the INFERNO flow** as a planner skill (`inception-import`)
  + a thin `/inception-to-inferno` launcher command, mirroring how
  `inferno-planner.md` launches the planner. It produces INFERNO artifacts, so
  it belongs to the flow this repo owns; it reads AI-DLC memory-bank as input.
- **Path resolution is the converter's own job** (a planner-tier agent reasoning
  over the brownfield codebase), preferring any paths pre-pinned by
  `/resolve-inception-docs`. This keeps the converter self-contained and robust
  even where `/resolve-inception-docs` / `/inception-discovery` are not present
  as flow sources in this repo. **(Worth confirming — see review.)**
- **kind/complexity inference**: story AC scope → `kind` (UI story → ui,
  endpoint story → api, etc.) and `complexity`; the agent decides, the test
  only checks the result is contract-valid.
- Dogfooded as an INFERNO intent per repo convention (plan via INFERNO, not the
  superpowers spec machinery).
