---
id: installer-inferno-config
title: Install wizard scaffolds .specs-inferno/config.yaml and names the real entry command
intent: production-mode-and-deep-intake
kind: behavior
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-07-02T00:00:00Z
---

# Work Item: Install wizard scaffolds .specs-inferno/config.yaml and names the real entry command

## Description

Move INFERNO config creation into `npx specsmd install` (FR-9..11, FR-13). In `src/lib/installer.js`: when the selected flow is inferno, after flow selection ask the config questions with the already-imported `prompts` package — (1) mode: select [production (default) | autonomous]; (2) worker model tiers strong/cheap/writer: defaults opus/sonnet/sonnet; (3) finalize verification commands: text input, split on commas, sensible default (e.g. "npm run build, npm test"), empty allowed to omit the section. Write `.specs-inferno/config.yaml` in the target repo from the answers, mirroring the new schema pinned in decisions.md C-3 (top-level mode, models, verification; commented like config.example.yaml). Every prompt must accept plain Enter for its default; when prompts is aborted or answers come back undefined (non-TTY), write the all-defaults config silently and continue — never hang or throw. Extract the answer→YAML rendering as a pure exported function so it is unit-testable. Fix the next-steps message: add per-flow entry-command metadata to the FLOWS object in `src/lib/constants.js` (e.g. `entryCommand`), print it instead of the hard-coded `/specsmd-master-agent` (INFERNO → `/specsmd-inferno-planner`; flows that ship a master agent keep `/specsmd-master-agent`). Add a new vitest suite under `src/__tests__/unit/installer/` covering the pure function: default config shape, mode/tier/verification overrides, abort fallback, and that every FLOWS entry has an entryCommand. Update `evals/install-eval.sh`: extend the scripted PTY keystroke sequence with the Enters (and timing) for the new prompts, and add a `req .specs-inferno/config.yaml` assertion.

## Acceptance Criteria

- [ ] INFERNO install writes .specs-inferno/config.yaml with the chosen or default values; selecting any other flow asks no new questions and writes no config
- [ ] The plain-Enter path yields mode production, models opus/sonnet/sonnet, and the default verification commands
- [ ] Prompt abort / non-TTY yields the same all-defaults config and a zero exit
- [ ] Next-steps output names the selected flow's real entry command via FLOWS metadata (INFERNO → /specsmd-inferno-planner)
- [ ] New installer vitest suite passes under "cd src && npm test"; existing suites stay green
- [ ] evals/install-eval.sh drives the new prompts and asserts .specs-inferno/config.yaml exists in the sandbox

## Caveats

Load-bearing facts from `decisions.md` that apply to THIS item — inlined here so the
builder acts on them without a second hop. Each states what to do or what NOT to assume.

- **C-3** — Mode semantics are EXACTLY: production = staged deep intake + one post-write review pause + delivery default merge-request; autonomous = lean intake + no pause + delivery default auto-close; explicit delivery.mode beats the mode-derived default. The scaffolded YAML must match this schema.
- **C-5** — evals/install-eval.sh drives the wizard via a scripted PTY byte sequence (Enter → 5×Down → Enter → wait). New prompts MUST default-on-Enter, and the eval script must be extended with the matching keystrokes in the SAME work item, plus a req .specs-inferno/config.yaml assertion.
- **C-6** — Installer prompts use the prompts npm package already imported in src/lib/installer.js line 3 (NOT inquirer). On prompt abort/non-TTY, prompts returns undefined answers — the installer must fall back to writing the default config, never hang or throw.
- **C-7** — Builders edit ONLY src/flows/**, src/lib/**, src/__tests__/**, evals/install-eval.sh. The installed .specsmd/ + .claude/ copies in this repo are refreshed by the dogfood reinstall AFTER merge — do NOT edit them directly.
- **C-10** — Ruben has not confirmed the four provisional decisions. Build to the provisional decisions; do NOT push to origin or publish; final sign-off happens when he tests the merged tree.
- **C-12** — Fresh worktrees lack src/node_modules; symlink it from the main checkout before running tests, and never use check:webview-bundle/validate:all as a worktree gate (pre-existing gitignored-artifact gap). The gate is cd src && npm test plus cd src && npm run lint:md.

## Execution Manifest

context:
  required:
    - path: .specs-inferno/intents/production-mode-and-deep-intake/decisions.md
      reason: config schema (C-3), eval constraint (C-5), and prompts fallback (C-6) are pinned here
    - path: src/lib/installer.js
      reason: primary file — install() lines ~70-202, installFlow ~204-294, next-steps ~163-188
    - path: src/lib/constants.js
      reason: FLOWS object gains per-flow entryCommand metadata
    - path: evals/install-eval.sh
      reason: PTY keystroke script and assertions to extend
  patterns:
    - path: src/lib/installer.js
      reason: existing prompts usage (multiselect line ~108, select line ~135) is the idiom for the new questions
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: target YAML shape and comment style for the scaffolded config (being reworked in parallel by config-mode-schema; schema contract is decisions.md C-3)
  tests:
    - path: src/__tests__/unit/installer/
      reason: NEW suite to author here (directory does not exist yet; follow src/__tests__/unit/inferno/inferno-flow.test.ts for vitest conventions)
    - path: src/vitest.config.ts
      reason: runner config the new suite must be picked up by
ownership:
  editable:
    - src/lib/installer.js
    - src/lib/constants.js
    - src/__tests__/unit/installer/
    - evals/install-eval.sh

## Technical Notes

Keep the config questions AFTER flow selection so non-INFERNO installs are untouched.
Do not attempt PTY-level tests — test the extracted pure function. The eval's timing
values (sleep) are tuned for npx cold start; extend, don't shrink them. installFlow's
rollback (installer.js ~296-317) should also remove a scaffolded .specs-inferno/config.yaml
on failure if straightforward; note it in comments if you decide otherwise.

## Dependencies

(none)
