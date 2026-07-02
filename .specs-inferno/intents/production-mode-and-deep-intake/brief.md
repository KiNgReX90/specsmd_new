---
id: production-mode-and-deep-intake
title: Production/autonomous modes, deep intake questioning, and install-time INFERNO config
status: pending
created: 2026-07-02T00:00:00Z
---

# Intent: Production/autonomous modes, deep intake questioning, and install-time INFERNO config

## Goal

Collapse INFERNO's two mode knobs into one top-level `mode: production | autonomous`,
make production mode interrogate requirements like the classic AI-DLC inception agent,
give AI-DLC Turbo's inception the same mandatory deep-dive questioning, and move
INFERNO config creation into the install wizard so a freshly installed project starts
with a `.specs-inferno/config.yaml` instead of discovering a separate command later.

## Users

specsmd users installing and running the INFERNO or AI-DLC Turbo flows — concretely
Ruben and the internal teams dogfooding this fork.

## Problem

Three overlapping names confuse even the maintainer: `autonomy.level: full | review`
(planner pause) and `delivery.mode: auto-close | merge-request` — whose comments already
nickname the delivery modes "autonomous" and "production". Meanwhile the INFERNO
planner's intake is free-form at high degrees of freedom and skates past load-bearing
questions, and AI-DLC Turbo's lean pipeline dropped the system-context stage whose
boundary/integration questioning made classic inception feel thorough. Finally, INFERNO
config is a separate post-install command (`/specsmd-inferno-config`) that is easy to
miss — this very repo ran without a config.yaml until today.

## Success Criteria

- One top-level `mode: production | autonomous` in `.specs-inferno/config.yaml` drives
  (a) planner intake depth, (b) the single post-write review pause, and (c) the delivery
  default (production → merge-request, autonomous → auto-close); `delivery.mode` remains
  an explicit override; a legacy `autonomy.level` key still works when `mode` is absent
  (review → production, full → autonomous).
- In production mode the planner runs a staged questionnaire — core questions, then a
  mandatory deep-dive round (edge cases, error handling, data, integrations, NFRs), then
  full summary approval — before decomposition; autonomous mode keeps the lean intake.
- AI-DLC Turbo's requirements skill gains the mandatory deep-dive round, and the
  system-boundary/integration questions lost with the context stage are folded into
  decisions-and-gates; lean stays lean (no ceremony documents return).
- `npx specsmd install` with INFERNO selected asks the config questions (mode, model
  tiers, finalize verification commands) with Enter-through defaults, writes
  `.specs-inferno/config.yaml`, and the next-steps message names the flow's real entry
  command instead of `/specsmd-master-agent`; the deterministic install eval is updated
  and green.
- Full test suite, markdown lint, and the install eval pass on the integrated tree.

## Constraints

- Builder/writer command↔agent parity tests must remain untouched (no edits to builder
  or writer surfaces).
- No file in the inferno tree may reference the FIRE artifact namespace (test-enforced).
- The planner NEVER starts the build in either mode — that invariant survives the rename.
- The install eval drives the wizard through a scripted PTY keystroke sequence; every new
  install-time question must accept Enter for its default, and the eval script is updated
  in the same change.
- README/PRD updated so shipped docs match the new mode vocabulary.

## Notes

Decisions taken provisionally with Ruben AFK (he asked for parallel progress and invited
pushback; these follow the recommended options presented): (1) single `mode` key with
`delivery.mode` kept as override rather than hard-bundling; (2) deep questionnaire only
in production mode; (3) Turbo gets the deep-dive round rather than restoring the context
stage; (4) `/specsmd-inferno-config` is kept as the config *editor*, install becomes the
primary creation path. Cross-intent check: both existing intents are completed →
independent.
