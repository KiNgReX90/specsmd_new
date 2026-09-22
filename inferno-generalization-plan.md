# INFERNO, generalization plan

Written 2026-09-22 from a read of the canonical flow (`src/flows/inferno/`), five consumer installs and the machine-side tools they lean on. Goal: a stranger with a different stack, a different machine and possibly a different model plan installs INFERNO and builds an intent without editing a flow file. Each item names the change, the evidence that it is needed, and the measurement that proves it landed. Order is a recommendation; reorder freely.

## Handoff status

Read this first if you are picking the work up on another machine.

- **Done and on `main`:** Phase 0.1. The repo no longer contains a home directory path, a personal name or a private project name. Everything else below is untouched and unstarted.
- **Not required:** none of Phase 1 to 4 is a commitment. Treat them as a ranked backlog of findings, not a contract. Take an item when it blocks you, skip the rest.
- **To pick up anywhere:** clone the repo, `cd src && npm ci && npm run validate:all`. No machine-local tool is needed any more; the optional ones are named in Phase 2.1 and everything degrades to a no-op when absent.
- **Two optional hooks now read env vars instead of a fixed path.** `INFERNO_FLOW_BUDGET` (a flow text-budget script) and `SECRETS_CONFIG` (the off-repo file of literal secret values the pre-commit hook greps for). Unset on a fresh machine means the check is skipped, not failed.

Consumer repos are referred to by shape, not by name: **app repo** (Tauri, SvelteKit, Rust, Playwright, the largest install), **docs repo** (Node, scripts, Rust), **python repo** (uv, pytest, ruff), **site repo** (Astro), **admin repo** (Node, knowledge base, Playwright).

## What is already generic

- The flow copy in the app repo differs from canonical in 5 files by 4 to 6 lines each. The stack does not live in the flow files.
- `.specs-inferno/config.yaml` already carries the stack. The python repo gates on `uv run ruff check && uv run pytest`, the site repo on `npx astro check`, the app repo on cargo, vitest and Playwright. `worktree.bootstrap`, `finalize_scopes`, `dispatch.constraints` and `delivery` are the right escape hatches.
- The scripts have zero dependencies and read only config, the ledger and the manifests.
- The artifact format, the single ledger writer, the oracle, the no-parking rules and the proof cache are the product. None of that changes here.

## Where the coupling is

1. **The maintainer's machine ships inside the package.** `codex/rules/claude-build.rules` allows a build wrapper by an absolute path under a developer's home. `run-intents.cjs` defaults a text-budget check to a named machine-local hooks directory. `run-lib.cjs` wraps any heavy command in a specific wrapper binary when it is on PATH. The builder charter explains exit 137 and 143 as "the cap". The Codex builder procedure names that wrapper's log file, its exit 75 and a 30-minute yield. Budget halt, scheduling and headless runs live in the maintainer's `~/.claude/` and the README points at a `/schedule-inferno` command the package does not ship.
2. **Model pins are frontmatter.** Builder, planner and oracle pin specific Claude model ids; the Codex tomls pin specific OpenAI ones. `models.strong` and `models.cheap` only override the builder dispatch. A user whose plan lacks the frontier tier has to edit installed files to run the oracle.
3. **Host conventions are assumed by name.** An integration test-case file with `TC-<n>` ids and `reserve:` handoff lines, a tester agent with `models.tester` and `models.tester_high`, a per-file line cap check, a reader profile and a writing skill, a TDD skill, a knowledge index, a mockups directory. Most are phrased "when the project ships one", which is the right shape, but nothing declares which ones a project has, so every charter carries every clause and the planner writes `reserve:` lines for a case file the project does not have.
4. **Lab notes ship as product text.** The orchestrator charter carries 7 dated incident lines and two personal attributions, the oracle 3, and 12 non-test scripts carry dated measurements naming private repos. The rules are right. The narrative is the reason the text budget exists.
5. **Linux-only mechanics fail silently.** Process-in-worktree and session-ancestor detection read `/proc` and return null elsewhere, so on macOS recovery and ownership degrade to the older heuristics without saying so.
6. **Canonical is not what runs.** The app repo's flow copy has 62 local commits; the docs repo split the scripts its own way (23 files differ, 30 exist on one side only). Install is copy-once with no upgrade path, so every flow change is ported by hand two or three times and the copies drift in both directions (the app repo has a `parked` menu block canonical lacks, canonical has tester keys the app repo lacks).
7. **The evals prove one stack on one host.** The e2e sandbox is a Node toy with `npm test`; the install eval drives an interactive PTY with sleeps and four cursor-down keystrokes to reach INFERNO. No Python, Rust or Go fixture, no non-interactive install, no host besides Claude Code and Codex despite the flow registry offering INFERNO to all eleven installers.
8. **The Codex config duplicates the Claude one.** The app repo's `config.codex.yaml` repeats the whole verification block of `config.yaml`; only the roles differ.

## Principles for every change

- A generalization displaces words, never adds them. The text-budget ceilings (builder 4000, orchestrator 5000, planner 4500) are the constraint; canonical sits at 2268, 3161 and 3107 with the host charter still to add.
- A machine fact lives in config or in an optional companion tool, never in a charter or a script default.
- A convention is declared once in config and referenced by key, or it does not exist for that project.
- Canonical is the only copy that gets edited. A fix found in a project is made in canonical and reinstalled.
- Nothing in the repo names a private project, a person or a home directory. A public repo is the audience for every line.

## Phase 0: make the repo publishable (done, 2026-09-22)

**0.1 Strip the machine and the private names.** Done. The execpolicy rule dropped its absolute home path and the installer test its assertion; the text-budget lookup moved to `INFERNO_FLOW_BUDGET` with an XDG default; three script comments, two charter attributions and one intent brief lost their private names; the repo's own pre-commit hook moved its secrets-config path to `SECRETS_CONFIG`; the historical planning docs under `docs/` had their home paths and names rewritten.
Proof: a case-insensitive grep for a home directory path, the maintainer's name or any private repo name prints nothing outside vendored upstream content.

**0.2 Root docs anonymized.** Done. This file and `inferno-future-improvements.md` refer to consumer repos by shape only.

## Phase 1: canonical is what runs

**1.1 `specsmd upgrade`.** Refreshes `.specsmd/inferno/**`, the Claude adapters and the Codex bundle from the installed package version, never touches `.specs-inferno/**`, prints the files it changed, and ends with the one line that a running Claude session keeps its old agent definitions. Non-interactive flags on install and upgrade (`--flow inferno --tools claude,codex --yes`) so evals and CI stop driving a PTY.
Proof: `install-eval.sh` loses its `sleep` lines; `specsmd upgrade` on a fresh install of the previous tarball reports zero changes under `.specs-inferno/`.

**1.2 Fold the forks.** Port what the app repo has that canonical lacks (the `parked` menu block, the Claude intents command, `verification.integrate` in the example). Port what the docs repo's script split does that canonical does not (future-improvements item 6). Reinstall both from canonical and run their flow suites in place.
Proof: `diff -rq <repo>/.specsmd/inferno src/flows/inferno` prints nothing for both repos, and neither gains a local flow commit afterwards.

**1.3 Codex config inherits.** `config.codex.yaml` carries roles and Codex-only overrides; `readConfig` layers it over `config.yaml`.
Proof: the app repo's `config.codex.yaml` shrinks to its roles block and `run.cjs gate --config .specs-inferno/config.codex.yaml` produces the same proof keys as before.

## Phase 2: cut the machine out of the flow

**2.1 An `environment` section in config.** `environment.build_wrapper` (a command prefix, absent means bare), `environment.text_budget` (a command, absent means no check), `environment.log` (where the wrapper writes). `run-lib.runShell` and `run-intents.refuseOverBudget` read these instead of probing PATH and a hardcoded home directory. The Codex execpolicy rules file is generated from the same keys at install, so no home path ships in the package.
Proof: the Phase 0 grep still prints nothing after the feature lands; on a box with no wrapper the toy e2e gate runs bare and green.

**2.2 Machine talk leaves the charters.** Every sentence about caps, exit codes, wrapper logs, yield times and lock waits moves to `dispatch.constraints`, where the consumer configs already repeat it. The charters keep one sentence: obey `dispatch.constraints` verbatim. The Codex builder procedure loses its Tauri-specific example command.
Proof: charter word counts drop (target builder under 2000, orchestrator under 2900); the app repo's dispatch behaves the same because its config already carries the lines.

**2.3 Reference host tools as an opt-in companion.** `src/flows/inferno/host-tools/` ships portable reference scripts: a build queue on `flock` without systemd, a text-budget script, a halt-wait script that sleeps a configured number of hours, a headless runner. The config wizard offers them and writes the `environment` and `halt` keys when accepted. A maintainer's own richer versions keep living outside the repo and win by config.
Proof: install-eval with the companion accepted runs the toy gate through the reference queue; without it nothing under `$HOME` is referenced.

**2.4 Lab notes become a decision log.** Dated incidents, token counts and attributions move to `docs/inferno/decisions.md`, one entry per rule, keyed by the rule sentence it justifies. Charters, `config.example.yaml` and script comments keep the rule and a one-word key.
Proof: `grep -cE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' agents/*/agent.md agents/orchestrator/config.example.yaml` prints 0 for every file.

**2.5 Platform gaps say so.** `processesIn` and `sessionProcess` get an `lsof` and `ps -o ppid,comm` path for macOS, or `select` prints one line naming the signal it could not read. A CI matrix runs the script suites on ubuntu and macos.
Proof: the suites are green on both runners; `select` on a non-Linux box never offers a recovery it cannot justify.

## Phase 3: declare instead of assume

**3.1 A full model matrix in config.** `models.oracle`, `models.planner` and `models.config` join `strong` and `cheap`, with `effort` per role. The orchestrator passes the oracle model from config the way it passes the builder tiers; the config wizard writes the installed frontmatter (the Claude agent files and the Codex tomls) from the matrix. Canonical frontmatter holds defaults the README calls defaults, not a fixed matrix. `models.writer` is dropped from the three configs that still carry it.
Proof: set `models.oracle` to a cheaper id, run the wizard, spawn the oracle and read the model in its first line; the drift test compares bodies and ignores frontmatter.

**3.2 A `conventions` section in config.** `conventions.test_cases` (file and id pattern), `conventions.file_cap` (command), `conventions.copy` (skill name and reader profile path), `conventions.tdd` (skill name), `conventions.design_sources` (globs), beside the existing `knowledge.index`. Each charter clause that assumes one becomes a single sentence gated on the key. The planner emits `reserve:` lines only when `conventions.test_cases` exists. The wizard proposes each convention only when it finds the artifact in the repo.
Proof: on the toy repo with an empty config the planner handoff contains no `reserve:` or `Tester proves:` line and the builder result contains no design-fidelity or split line; on the app repo with the keys set the run output is unchanged.

**3.3 Stack detection in the wizard.** The wizard reads `package.json` scripts, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile` and `justfile` and proposes `verification.finalize`, `worktree.bootstrap` and the `finalize_scopes` globs per tool from a small table, then shows them for confirmation.
Proof: on each Phase 4 fixture the wizard's first proposal is the gate the fixture's README names, with no edit.

## Phase 4: prove it on strangers' stacks

**4.1 Fixtures per stack.** A hint, not a requirement: add a fixture for whichever stack you actually run, and skip the rest. Beside toy-math (Node), candidates are toy-java (Maven or Gradle, `mvn -q verify` or `./gradlew test`, and a multi-module build so compile serialization is exercised), toy-py (uv, pytest, ruff), toy-rs (a cargo workspace with two crates), toy-go (`go test ./...`), and toy-mixed (one front end plus one compiled module, with `finalize_scopes`). One fixture on a second stack is already most of the value; the point is that a stack whose gate is slow and whose build is heavy behaves under the flow, not the count of languages. Each fixture seeds one three-item intent with a dependency chain and one parallel pair.
Proof: `run-e2e.sh` on the fixture ends with the intent merged, pushed and its worktree gone, and prints rounds, wall time and exit in one table. Anything that breaks on the way there is the real output of this phase: file it as an issue rather than fixing it inline.

**4.2 Supported hosts stated and probed.** INFERNO needs subagent dispatch with a per-dispatch model override and git worktrees. The installer names Claude Code and Codex as supported; any other selected tool gets one line saying which capability it lacks, and installs the planner and config commands only.
Proof: install-eval with a third tool selected prints that line and creates no builder or orchestrator adapter for it.

**4.3 A getting-started page.** Install, wizard, the toy intent end to end, what the readout looks like, and a "what your machine needs" list (git with worktrees, node 18, optional companion tools). Written for someone who has never seen the maintainer's repos.
Proof: one stranger-run of the page on a clean VM reaches a merged toy intent with no question back to us, timed.

## Sequencing

Phase 0 is done. Then Phase 1, because until canonical is what runs every later change is ported by hand and every measurement is taken on a fork. Phase 2 and 3 can interleave by item; 2.1, 2.2 and 3.2 shrink the same charters and are best done as one pass per charter under the text budget. Phase 4 lands last and then stays as the regression suite for every future flow change.

## Baselines (2026-09-22)

| Measure | Value |
| --- | --- |
| App repo flow copy vs canonical | 5 files differ, 62 local commits |
| Docs repo flow copy vs canonical | 23 files differ, 30 one-sided |
| Charter words, builder / orchestrator / planner | 2268 / 3161 / 3107 |
| Text-budget ceilings | 4000 / 5000 / 4500 |
| Dated lines, orchestrator / oracle charters | 7 / 3 |
| Non-test scripts with dated measurements | 12 |
| Files leaking a home path or a private name | 0 (was 8 in shipped or public code plus 2 root docs; cleared in Phase 0.1) |
| E2e fixtures | 1 (Node), Claude host only |
