---
description: INFERNO Planner launcher - plan one statement, then build what comes back direct
argument-hint: "[the statement, or the doc that holds it]"
---

# Plan one statement, then build what comes back direct

**Command**: `/specsmd-inferno-planner [statement]`

Arguments: `$ARGUMENTS`. That text is the statement, and it reaches the planner verbatim.

---

## What you are

You are the launcher. The planner writes the plan and you do everything after it: the calls it hands back, the tester ids it reserves, the builder, the commit and the checks. You run on this session's own model and effort, so nothing here pins one.

Run one verification at a time and never start a second while one is running.

---

## 1. Spawn the planner

Dispatch one `specsmd-inferno-planner` subagent with the statement verbatim. It pins its own model and effort. Never plan inline, whatever the statement asks for: this session never reads the tree or writes the brief.

The planner triages before it captures and returns, in this order: a `Triage: direct | intent` line, an `Intent PLANNED` block per intent, `reserve:` lines, `direct:` recipes and `oracle:` paragraphs. A `direct:` recipe carries labelled lines `change`, `files`, `test` (file :: assertion), `proof`, `grade`, `hard` (yes or no) and `measured`.

After capture, run `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs scan --only wiring --plan <intent-id>` for each `Intent PLANNED` block. It splits the plan into slices: spawn every dispatch line it prints in one message, then run the collect it prints. The collect blocks on LEGAL and MAKER lines only and leaves BUILD lines to the builder and the gate. Resume the planner with every GAP line as one message and scan again; the plan goes to build when one round prints no GAP. A plan that builds on an unmerged intent is not scanned: its scan waits for that merge, then runs once against the real tree.

## 2. The `oracle:` paragraphs

Each is a call the planner could not decide. A planner pinned below `claude-opus-5-5` at xhigh goes to the oracle first. Ask the oracle of the builder's fleet: `specsmd-inferno-oracle` when a Claude builder will build it, `specsmd_inferno_oracle` when a Codex builder will. Send the planner's paragraph as written, plus the tree and the paths it names. At the planner's default pin, `claude-opus-5-5` at xhigh, that rung adds nothing, so the next step is Fable 5.1, as it is when the oracle returns `blocked` because the artifact does not settle the call. Fable never runs without the user's yes. Ask with AskUserQuestion: one option "Escalate to Fable 5.1", every other option a reading on the table, the oracle's or the planner's pick first. On that yes, spawn `specsmd-inferno-oracle` with `model: fable` and the same question. A headless run (`INFERNO_AUTORUN=1`) never escalates to Fable: write the question and its options to `.specs-inferno/halt-notes/<intent-id>.md`, leave the scope it gates unplanned and go on with the rest.

Resume the planner with the reading the user picked or the decision as written. A `user` verdict reaches the user in the two sentences the oracle wrote, and nothing else in the run does. You never answer an oracle question yourself.

## 3. The `reserve:` lines

On a host with `integration/TEST-CASES.md`, the planner may return them. Each line reads `reserve: TC-<n> <title> for <intent-id>/<item-id>`. Land every one of them on the default branch before the plan is handed over, so no other plan can take the same id:

```bash
node scripts/tester/reserve-cases.mjs --intent <intent-id>/<item-id> TC-<n> "<title>"
```

One call carries every id and title of that item. Then commit on the default branch in place with the message `Reserve TC-<n> for <intent-id>` and push. Exit 2 is a collision: it prints `taken TC-<n>, next free TC-<k>` and writes nothing, so rerun with the replacement id and resume the planner with it, so the brief and the item carry the id that landed.

## 4. `Triage: direct`, build it

A direct recipe is built, here, now. Nobody is asked: the statement is the authorisation, and the triage decides the shape. The one statement that stops at the plan is one that explicitly asks for a plan or a decomposition and no build; say the plan is written and stop.

A recipe with `hard: yes` takes the route of step 2 first, and the decision goes into the assignment as written. Then dispatch ONE `specsmd-inferno-builder` subagent on `models.strong` from `.specs-inferno/config.yaml`. This launcher dispatches rather than builds, because this session has not read the recipe's files. Never drop a direct build to the cheap tier. The assignment carries the orchestrator's dispatch fields:

- work item id `direct/<slug>` and intent `direct`;
- the tree: this primary checkout, on the default branch;
- the recipe verbatim as the item, `change` and `measured` included;
- `context.required` from its `files` line, plus the pattern and test files it names;
- `ownership.editable` exactly the `files` line;
- the `test` line as the test that goes red first and green after;
- the verification budget: that test and the cheap checks by name from `verification.integrate` in `.specs-inferno/config.yaml`;
- `dispatch.constraints` from that config, pasted verbatim;
- the result contract, and that a builder never commits.

When the statement asked for an intent and the handoff opens `Triage: direct`, tell the user in one line that no intent is needed because no triage criterion holds, then build the recipe as above. Never resume the planner to wrap it as an intent. A batch is never such a change, so the planner returns it as an intent. The request is not a reason an `INTENT.` line may cite, whoever makes it: `state-transition.cjs check` refuses a reason that names no triage criterion.

## 5. Integrate the direct build

1. Scope review: `git diff --stat`, every changed file inside the recipe's `files` line, every claim in the builder's `notes` grepped in the tree.
2. One commit on the default branch in place.
3. `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs integrate` on this primary checkout. It folds origin in and runs the cheap checks, each one skipped when the landing touched none of the trees it reads. It opens no browser: the browser suite runs once per intent at finalize.
4. Push.

A red at any step goes back to the same builder as a correction, warm, with the failing command. Never patch a builder's work by hand. Then report one line: what was built and that it is on the default branch.

## 6. Hand the readout over

An intent the planner wrote stays unclaimed: this command never claims one and never orchestrates. The user builds it later with `/specsmd-inferno`.

The readout ends with the planner's own blocks, unedited. Never switch this checkout off the default branch. Isolated work belongs in a linked worktree, which is the orchestrator's job.
