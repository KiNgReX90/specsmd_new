# Codex INFERNO planning procedure

The planner captures or repairs intent artifacts, decides their work-item records, renders every file itself, updates state once, prints a handoff and stops. It never starts implementation.

## Paths and canonical resources

- State: `.specs-inferno/state.yaml`
- Codex configuration: `.specs-inferno/config.codex.yaml`
- Intent brief: `.specs-inferno/intents/<intent-id>/brief.md`
- Work item: `.specs-inferno/intents/<intent-id>/work-items/<item-id>.md`
- Brief template: `.specsmd/inferno/agents/planner/templates/brief.md.hbs`
- Work-item template: `.specsmd/inferno/agents/planner/templates/work-item.md.hbs`
- Canonical planner body: `.specsmd/inferno/agents/planner/agent.md`

Read applicable `AGENTS.md` instructions. Read canonical resources as references but never edit them.

## Activation and user input

1. If `.specs-inferno/config.codex.yaml` is absent, return a compact `needs_config` result so the parent can complete `$specsmd-inferno-config`; never create a silent default file.
2. Read config, state when present, project instructions and the repository metadata needed to ground real paths. Classify a new scope against the other intents cheap-first: titles and state entry comments rule out a disjoint subsystem, and only a plausible overlap has its brief opened.
3. Determine whether to capture a new intent, decompose a pending one, or repair missing or invalid planning artifacts.
4. Settle essential product facts from the project's specs and the live code, never by asking. A call they leave open is returned as one `oracle` block (the question, the readings, what was measured, the paths) for the parent to settle, and no artifact is written for the scope that call gates. Never return a `questions` list and never pause for a person.

## Triage: intent or direct build

Run this triage on every request before capture, including one whose words ask for an intent. It fires at all times and no wording skips it.

A request is an intent only when at least one of these holds. There is no size criterion: two mechanisms and six required files are one batched dispatch. The two size criteria this list used to carry, **(a)** and **(b)**, are retired: they made an intent easier to capture than a build was to run.

- **(c)** a dependency chain where a later change cannot be tested before an earlier one lands;
- **(d)** disjoint ownership worth parallelising on disjoint compile trees;
- **(e)** a change that must not reach the default branch until the full gate proves it whole, such as a persisted-format migration or a definition version bump several documents read.

Everything else is a direct build, whatever its size in files: write no brief, no work item and no state entry for one. Every intent's state entry comment carries an `INTENT.` line saying why one builder on the default branch could not do it, and `state-transition.cjs check` refuses a reason that only restates size.

Report the verdict on the first handoff line. When the words ask for an intent and the triage says direct, say so and return the direct recipe anyway. Return each direct build as a recipe the strong builder executes in its first round, one labelled line each:

```text
direct: <slug>
  change: <the mechanism at file:line and the change, in a sentence>
  files: <the editable ownership list, comma separated>
  test: <test file> :: <the assertion that goes red first>
  proof: <the command that proves done, plus the cheap checks by name>
  grade: low | medium | high
  hard: yes | no
  measured: <what was measured and the command>
```

`grade` follows the work-item grading rules, because the parent tiers the builder by it. `hard: yes` when the change has more than one defensible shape, or a cause the measurement did not settle, so the parent asks the oracle first. Measure before writing a recipe and never hand over a slug the builder must search for.

## Capture and cross-intent reconciliation

1. Establish the goal, users, problem, success criteria, constraints, non-goals and preferences.
2. Compare the proposal with every non-completed intent and classify the relationship: **independent** when scopes and ownership proceed separately, **integrate** to fold it into an existing pending intent, **depend** to create it separately with the prerequisite id in `depends_on_intents`, **conflict** to read both briefs and the specs and return an `oracle` block when they do not settle it.
3. Keep intent-level dependencies acyclic, pointing only to known non-completed intents.
4. A request the triage calls direct never enters state: return it as a direct recipe for the parent to dispatch, with no ledger entry. Never write `.specs-inferno/quick-fixes.md` or any other parking file; `state-transition.cjs check` reports it as drift. Couple work that changes one surface; never bundle unrelated fixes into a catch-all intent.
5. Resolve every choice the specs settle and record the assumption, whatever `autonomy.level` says; there is no review pause in any mode.
6. Render the brief with the canonical template and add or update the state intent record, preserving unknown state fields and unrelated comments.

## Repository grounding

Before decomposition, use `rg`, `rg --files`, manifests, tests and focused source reads to verify every path and pattern. Never place a guessed path in a work item.

For each planned change, identify the primary implementation target and why it is required, an existing pattern for behavior, architecture, UI or API work, the relevant tests or an explicit docs-only or config-only exemption, every path the builder may edit, dependencies on earlier outputs, the narrow verification command, any `finalize_check`, and an exact design source when visual or contract values must be matched.

## Work-item decomposition

Every item uses `execution: autopilot` and includes:

```yaml
context:
  required:
    - path: src/app/foo.ts
      reason: Primary implementation target
  patterns:
    - path: src/app/bar.ts
      reason: Existing pattern to follow
  tests:
    - path: src/app/foo.spec.ts
      reason: Relevant test coverage
ownership:
  editable:
    - src/app/foo.ts
    - src/app/foo.spec.ts
probes:               # optional, read-only measurements the plan depends on
  - run: "git grep -c 'border-radius' src/lib/board/tile.css"
    shows: "4"
reads:                # optional, only when the surface draws a value the backend owns
  - path: src/app/foo.ts
    source: the backend command, store row or event behind the value
    when: every moment the surface reads it again
    stale: what the user sees on screen if it never reads again
diagnosis:            # required on a corrective ui or behavior item
  claim: "the shelf foot adds 104 px under the board at 960"
  probe: "npx playwright test e2e/dashboard.spec.ts -g 'the board fits'"
  shows: "1 failed"
```

Also decide id, title, kind, complexity, acceptance criteria, `depends_on`, exact verification, optional `finalize_check` and optional `design_contract`.

### Contract rules

- `context.required` and `ownership.editable` are always non-empty. Patterns are required for behavior, architecture, UI and API work. Tests are required unless the item is explicitly docs-only or config-only.
- `reads:` is optional. An item whose surface draws a value the backend owns carries one entry per value, each with a non-empty `path`, `source`, `when` and `stale`; an item drawing nothing from the backend omits the field. The `stale` sentence names what the user sees when the surface never reads again, because that is what the builder's first failing test asserts.
- `probes:` is optional. Every number the plan depends on becomes a probe on the item that depends on it. `run` is one read-only shell line, never a suite and never a write; `shows` is the exact trimmed stdout that was seen. Both are double-quoted. A probe is never an acceptance criterion: the orchestrator reruns it with `run.cjs probes <item-id> --tree <dir>` and hands the drift to the builder.
- `diagnosis:` is required on a ui or behavior item that exists because something is wrong on the screen today. `claim` is the cause in one sentence, `probe` the bare command that shows it, `shows` the line it printed. A pixel or position claim comes from browser geometry, never from adding up declarations. `run.cjs frontier` replays it and blocks the dispatch on a missing block, a failing probe or output that no longer matches.
- Dependencies are known and acyclic.
- Prefer disjoint ownership when it reflects the code, and never falsify it to create parallelism. When several items truly edit one file, encode dependencies or accept scheduler serialization.

### Size both ways

Split an item that spans more than two concerns, needs substantially more than six context files, or is unlikely to finish in one bounded stretch. Merge adjacent low or medium items in a strictly serial same-tree chain when splitting adds cold starts without enabling parallelism. High-complexity items remain standalone.

An item boundary preserves every existing invariant, so the tests, allowlists, goldens and docs an invariant needs travel in the item with the source change they follow.

### Blast radius is measured

List every test that consumes a changed symbol, count, golden or catalogue in `ownership.editable` with the value it must show; `run.cjs frontier` prints what you missed as `candidate` lines.

### Verification-item convention

Do not add a trailing test-only item: each builder verifies its own slice and finalization runs the authoritative suite once. Put a cheap mechanical post-merge invariant on the owning item as a one-line `finalize_check`, scoped only, never a suite the finalize list already runs.

Acceptance criteria and per-item verification commands name the one spec or test file the item adds or changes, never a full suite. An item applying one mechanism to several surfaces owns every surface and declares one test per surface and one per journey. A browser test is for functionality a person drives in the browser; copy, labels, formatting and anything asserted on one component's rendered output are unit tests that render the component. Appearance, and anything only the built binary shows, is a case in the integration case list with a test beside it, proved by the harness that owns it.

Create a `kind: test` item only when verification itself requires real reasoning, such as a computed cross-surface invariant. It depends on the relevant implementation items, stays capped, and does not rerun the final gate.

### Tester case reservation

The brief names the tester case ids the intent touches: an existing id for a changed journey, and for a new one the next free id from `integration/TEST-CASES.md`, which the planner never writes. Return each new id as its own handoff line, exactly `reserve: TC-<n> <title> for <intent-id>/<item-id>`, so the parent lands the reservation at planning time; a collision comes back with the replacement id to apply to the brief and the work item. The work item that changes the journey owns the case text and its test.

### High-complexity decisions

A high-complexity item carries its decisions under Technical Notes, one line each for the decision, the choice and the reason. No separate design file.

## Rendering the artifacts

The planner makes every decision and writes every file.

1. Build a complete decision record for each work item, every required and optional template field included.
2. Render each record from the canonical work-item template into `.specs-inferno/intents/<intent-id>/work-items/<item-id>.md`.
3. Parse the frontmatter of every file written and confirm each manifest field is present. A missing or unrenderable field is a defect in the record: fix it and render again.
4. Only after all files validate, update `.specs-inferno/state.yaml` once with the work-item list and intent metadata.

## Validation

Before handoff:

1. Parse state and every new frontmatter block.
2. Confirm every manifest field, editable path, dependency, complexity and verification command, that item and intent dependencies are acyclic, that no two supposedly parallel items overlap editable ownership, and that design contracts cite an exact source.
3. Confirm every behavior, ui, api and architecture item carries its blast-radius list: the test files in `ownership.editable` plus one acceptance criterion each.
4. Run the canonical decomposition contract test when its prerequisites are available:

   ```sh
   node --test .specsmd/inferno/agents/planner/scripts/team-work-item-contract.test.cjs
   ```

## Handoff and stop

Print:

- the triage verdict first, `Triage: direct` or `Triage: intent, because <the letter and one clause>`;
- intent title and id, the ordered work items with complexity and dependency summary, and which can start in parallel;
- the `reserve: TC-<n> <title> for <intent-id>/<item-id>` lines, one per reserved case id;
- the direct recipes, the `oracle` blocks, and the significant look change the intent carries, when there are any.

Print the summary and stop, in every mode. Never offer a choice of routes and never start builders. End by saying the plan is ready and can be built with `$specsmd-inferno`.
