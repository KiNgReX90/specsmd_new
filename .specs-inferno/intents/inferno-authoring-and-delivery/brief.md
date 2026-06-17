---
id: inferno-authoring-and-delivery
title: Parallel scribe authoring, config-driven tiers, and delivery modes
status: pending
created: 2026-06-17T00:00:00Z
---

# Intent: Parallel scribe authoring, config-driven tiers, and delivery modes

## Goal

Make the INFERNO planner author its work-item artifacts fast by fanning out the
*writing* to parallel scribe subagents — one file per work item — while ALL the
content and reasoning stays in the Opus 4.8 planner. Surround that with a
simpler first-run configuration experience, explicit default model tiers/effort,
and a config-selected delivery mode (autonomous auto-close vs. production
merge-request trickle-down).

This intent modifies the INFERNO flow SOURCES under
`src/flows/inferno/` in this repo (the canonical source of truth). Eval-harness
updates in the downstream `specsmd_new` repo (pack -> install-eval -> e2e) are a
separate step, not part of this intent.

## Users

- Developers running the INFERNO flow on a real project (the end users of the
  planner/orchestrator).
- The flow maintainer (Ruben), who wants planning to scale to many work items
  without serial write latency, and a lower-friction first run.

## Problem

1. **Serial artifact writing.** Today `work-item-decompose` step 8 has the single
   planner agent render and write every work-item file itself, sequentially.
   For an intent with many work items this serializes a lot of token generation
   and "takes forever to write everything."
2. **Silent, opt-in config.** With no `.specs-inferno/config.yaml`, the flow runs
   with no model tiering and never tells the user; the `/specsmd-inferno-config`
   wizard exists but nothing prompts a new project to run it, and it interrogates
   the user key-by-key with raw model IDs.
3. **One-size delivery.** The orchestrator always commits items directly onto the
   intent branch and auto-merges locally at finalize. There is no review-gated,
   merge-request-based delivery path for "production" use.

## Success Criteria

- The Opus 4.8 planner performs 100% of decomposition reasoning + validation +
  the approval gate; after approval it emits a complete decision record per work
  item and fans out one pure-scribe writer subagent per item, in parallel, each
  rendering exactly one `work-items/{id}.md`. Writers do zero reasoning and no
  codebase reads, and never touch `state.yaml`.
- Writers run on a configurable cheap tier (`models.writer`, default = `models.cheap`),
  with a host-without-subagents fallback to sequential writing.
- First run with no config DISPLAYS the defaults in plain language ("complex
  work items" / "simple work items", reviewed-before-build, delivery mode) and
  lets the user confirm or adjust — it does not interrogate key-by-key, and keeps
  raw model IDs in the background.
- Default tiers: complexity low -> Sonnet 4.6; complexity medium+high -> Opus 4.8
  at `xhigh` effort; kind config-only/docs-only/test -> Sonnet (override). This is
  already the tiering logic; the change is the explicit defaults + xhigh effort.
- A config-selected delivery mode: `auto-close` (today's local merge + close) and
  `merge-request` (per-item branches/MRs into the intent branch, intent MR into a
  user-confirmed base branch), forge-aware (gh/glab), host-neutral.
- `cd src && npm run validate:all` passes, including a new drift guard that keeps
  the writer command body in sync with the writer agent body and the
  FIRE-namespace guard over the new files.

## Constraints

- Edit only `src/flows/inferno/` sources (+ the flow's in-`src` tests/registration);
  the flow files must stay project- and host-neutral (no hardcoded model IDs,
  branch names, or forge).
- Preserve existing invariants: builders never commit or edit `state.yaml` or
  spawn nested subagents; the INFERNO tree never references the FIRE namespace;
  the command<->agent drift guard must hold for any new agent.
- Per-dispatch overrides are model-only today; per-tier effort rides agent
  frontmatter unless the design says otherwise.
- Both remotes are GitHub (gh available, glab not), but the MR logic must be
  forge-aware, not GitHub-hardcoded.

## Notes

User decisions captured during planning:
- Writer role = pure scribe (render only); 100% reasoning stays Opus 4.8.
- Writer model = cheap tier, configurable (`models.writer`, default `models.cheap`).
- Tier map locked: low->Sonnet, medium+high->Opus@xhigh, kind config/docs/test->Sonnet.
- Delivery = mode toggle, BOTH offered: auto-close (autonomous) and merge-request
  (production); base branch proposed by the agent and confirmed/alterable by the user.
- Config UX = display-defaults-and-confirm, not key-by-key interrogation.
- Plan + build this via the INFERNO flow itself (dogfood), not the superpowers
  brainstorming/spec machinery.
