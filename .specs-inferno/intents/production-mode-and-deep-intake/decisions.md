---
intent: production-mode-and-deep-intake
scope: src/flows/inferno, src/flows/aidlc-turbo, src/lib/installer.js, evals/install-eval.sh
---

# Decisions & Caveats — Production/autonomous modes, deep intake questioning, and install-time INFERNO config

## Key decisions (dated)

| Date | Decision | Rationale | Status |
|------|----------|-----------|--------|
| 2026-07-02 | Single top-level `mode: production \| autonomous` replaces `autonomy.level`; `delivery.mode` kept as explicit override | The two-knob split plus "autonomous"/"production" nicknames in config.example.yaml comments confused the maintainer himself; hard-bundling would break the dogfood combo (deep planning + local auto-close) | decided (provisional — Ruben AFK, recommended option) |
| 2026-07-02 | Deep staged questionnaire runs ONLY in production mode | Autonomous mode exists for speed; user's own framing ties the questionnaire to production | decided (provisional) |
| 2026-07-02 | Turbo gets a mandatory deep-dive round; context stage stays dead | Turbo's requirements skill already textually equals classic's (verified by diff) — the felt gap is the lost boundary questioning, which moves into decisions-and-gates as questions, not a document | decided (provisional) |
| 2026-07-02 | Install wizard creates `.specs-inferno/config.yaml`; `/specsmd-inferno-config` retained as editor | User called the separate command confusing; deleting it entirely would leave no guided way to change mode mid-project | decided (provisional) |
| 2026-07-02 | Legacy `autonomy.level` maps review→production, full→autonomous when `mode` absent; both absent → production | Existing consumer repos (agentic-ai runs INFERNO at repo root) must not silently change behavior on flow upgrade | decided |
| 2026-07-02 | Absent-config default is `production` | Matches today's default (`review` pause + questions); the safe end of the axis | decided |
| 2026-07-02 | Installer next-steps names per-flow entry command via FLOWS metadata | Message hard-codes `/specsmd-master-agent`, which doesn't exist for INFERNO (installer.js:170-173) | decided |

## Open questions & caveats

Load-bearing facts. Each MUST survive into at least one work item (inlined in its
`## Caveats` and linked via `context.required`). The build rule states exactly what a
builder must do — or must NOT assume.

| ID | Status | Build rule (what to do / what NOT to assume) |
|----|--------|----------------------------------------------|
| C-1 | resolved | `src/__tests__/unit/inferno/inferno-flow.test.ts` asserts builder/writer command bodies are byte-identical to their agent bodies. Do NOT edit `agents/builder/**`, `agents/writer/**`, `commands/inferno-builder.md`, or `commands/inferno-writer.md`. |
| C-2 | resolved | The same test forbids any `.specs-fire` / `.specsmd/fire` reference in the inferno tree. Never write those strings, even in examples or migration notes. |
| C-3 | resolved | Mode semantics are EXACTLY: production = staged deep intake + one post-write review pause + delivery default merge-request; autonomous = lean intake + no pause + delivery default auto-close; explicit `delivery.mode` beats the mode-derived default. Do not invent additional mode effects (model tiers, halt, verification are mode-independent). |
| C-4 | resolved | The planner NEVER starts the build in either mode — every file that states this invariant keeps stating it after the rename (agent.md handoff_format, commands/inferno-planner.md, config.example.yaml comments, README, PRD). |
| C-5 | resolved | `evals/install-eval.sh` drives the wizard via a scripted PTY byte sequence (Enter → 5×Down → Enter → wait). New prompts MUST default-on-Enter, and the eval script must be extended with the matching keystrokes in the SAME work item, plus a `req .specs-inferno/config.yaml` assertion. |
| C-6 | resolved | Installer prompts use the `prompts` npm package already imported in `src/lib/installer.js:3` (NOT inquirer). On prompt abort/non-TTY, `prompts` returns undefined answers — the installer must fall back to writing the default config, never hang or throw. |
| C-7 | resolved | Builders edit ONLY `src/flows/**`, `src/lib/**`, `src/__tests__/**`, `evals/install-eval.sh`. The installed `.specsmd/` + `.claude/` copies in this repo are refreshed by the dogfood reinstall AFTER merge — do NOT edit them directly. |
| C-8 | resolved | Turbo stays lean: FR-8 adds *questions* feeding the decisions-and-gates ledger; do NOT reintroduce system-context.md, impact-analysis, inception-log, or any new document type. |
| C-9 | resolved | `mode` is read from `.specs-inferno/config.yaml` by flow *markdown instructions* (agents interpret it), not by runtime code — there is no YAML parser to update; consistency across all 11 files referencing autonomy/delivery is the actual deliverable. Files: README.md, PRD.md, agents/planner/agent.md + its 4 skill files, agents/orchestrator/agent.md + config.example.yaml, commands/inferno.md, commands/inferno-planner.md, commands/inferno-config.md. |
| C-10 | OPEN | Ruben has not confirmed the four provisional decisions (mode shape, production-only depth, turbo approach, keep-editor-command). Build to the provisional decisions; do NOT push to origin or publish; final sign-off happens when he tests the merged tree. |
| C-11 | resolved | The `mode` questionnaire depth applies at INTAKE time (intent-capture/decisions-capture); decomposition and design-doc behavior stay unchanged apart from replacing the words `autonomy.level`/`review`/`full` with the new vocabulary. |
| C-12 | resolved | Fresh worktrees lack `src/node_modules`; symlink it from the main checkout before running tests, and never use `check:webview-bundle`/`validate:all` as a worktree gate (pre-existing gitignored-artifact gap). Finalize gate is `cd src && npm test` + `cd src && npm run lint:md`. |

## Release gates

- `cd src && npm test` green on the integrated tree (all suites incl. new installer tests).
- `cd src && npm run lint:md` clean.
- `npm pack` tarball + `evals/install-eval.sh <tarball>` passes with the new prompt sequence and asserts `.specs-inferno/config.yaml` in the sandbox.
- Zero occurrences of `autonomy.level` / `autonomy:` in `src/flows/inferno/` except the legacy-mapping note (`finalize_check` sweeps this).
- No push to origin, no PR, no publish — held until Ruben personally tests (hard gate).
