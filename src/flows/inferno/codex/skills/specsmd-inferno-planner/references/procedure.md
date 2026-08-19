# Codex INFERNO planning procedure

The planner captures or repairs intent artifacts, fully decides their work-item records, delegates only file rendering, updates state once, prints a handoff, and stops. It never starts implementation.

## Paths and canonical resources

- State: `.specs-inferno/state.yaml`
- Codex configuration: `.specs-inferno/config.codex.yaml`
- Quick fixes: `.specs-inferno/quick-fixes.md`
- Intent brief: `.specs-inferno/intents/<intent-id>/brief.md`
- Work item: `.specs-inferno/intents/<intent-id>/work-items/<item-id>.md`
- Optional design: `.specs-inferno/intents/<intent-id>/work-items/<item-id>-design.md`
- Brief template: `.specsmd/inferno/agents/planner/skills/intent-capture/templates/brief.md.hbs`
- Work-item template: `.specsmd/inferno/agents/planner/skills/work-item-decompose/templates/work-item.md.hbs`
- Design template: `.specsmd/inferno/agents/planner/skills/design-doc-generate/templates/design.md.hbs`
- Detailed canonical contracts:
  - `.specsmd/inferno/agents/planner/skills/intent-capture/SKILL.md`
  - `.specsmd/inferno/agents/planner/skills/work-item-decompose/SKILL.md`
  - `.specsmd/inferno/agents/planner/skills/design-doc-generate/SKILL.md`

Read applicable `AGENTS.md` instructions. Read canonical resources as references but never edit them. The `specsmd_inferno_planner` custom agent runs on `gpt-5.6-sol` with `xhigh` reasoning.

## Activation and user input

1. If `.specs-inferno/config.codex.yaml` is absent, return a compact `needs_config` result so the parent can complete `$specsmd-inferno-config`; do not create a silent default file.
2. Read config, state when present, every non-completed intent brief and work-item set, project instructions, and repository metadata needed to ground real paths.
3. Determine whether to capture a new intent, decompose an existing pending intent, or repair missing or invalid planning artifacts.
4. When essential product facts are missing, return only a short ordered `questions` list. The parent conversation asks them, then uses `followup_task` to continue this same planner with the answers. Ask only questions whose answers materially change the plan.

## Capture and cross-intent reconciliation

1. Establish the goal, users, problem, success criteria, constraints, non-goals, and important preferences.
2. Compare the proposal with every non-completed intent and classify the relationship:
   - **independent:** scopes and ownership can proceed separately;
   - **integrate:** fold the work into an existing pending intent;
   - **depend:** create it separately and record the prerequisite intent id in `depends_on_intents`;
   - **conflict:** surface the incompatible decision before writing.
3. Keep intent-level dependencies acyclic and point only to known non-completed intents.
4. Apply the intent-worthiness gate. One work item is a quick fix and belongs in `.specs-inferno/quick-fixes.md` with any `after: <intent-id>` ordering and `verify:` line on the entry; a dependency, a shared file, a user look or the complexity label do not make it an intent. Only an explicit user request or a named open design question lifts one item, written into the state entry as `single_item_reason`, which `state-transition.cjs check` requires on any pending one-item intent. Couple work that changes one surface; never bundle unrelated small fixes into a catch-all intent.
5. Under `autonomy.level: full`, resolve non-critical choices and record assumptions. Under `review`, relay only a decision that materially changes scope or architecture.
6. Render the brief with the canonical template and add or update the state intent record. Preserve unknown state fields and unrelated comments.

## Repository grounding

Before decomposition, use `rg`, `rg --files`, manifests, tests, and focused source reads to verify every path and pattern. Do not place guessed paths in a work item.

For each planned change, identify:

- the primary implementation target and why it is required;
- an existing pattern for behavior, architecture, UI, or API work;
- relevant tests, or an explicit docs-only or config-only exemption;
- every path the builder may edit;
- dependencies on outputs from earlier items;
- the narrow verification command;
- any post-integration `finalize_check`;
- an exact design source when visual or contract values must be matched.

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
```

Also decide id, title, kind, complexity, acceptance criteria, `depends_on`, exact verification, optional `finalize_check`, and optional `design_contract`.

### Contract rules

- `context.required` and `ownership.editable` are always non-empty.
- Patterns are required for behavior, architecture, UI, and API work.
- Tests are required unless the item is explicitly docs-only or config-only.
- Dependencies are known and acyclic.
- Prefer disjoint ownership when it reflects the code, because the orchestrator can then execute items in parallel. Never falsify ownership to create parallelism.
- When multiple items truly edit one file, encode dependencies or accept scheduler serialization.

### Size both ways

Split an item that spans more than two concerns, needs substantially more than six context files, or is unlikely to finish in roughly thirty capability rounds. Merge adjacent low or medium items in a strictly serial same-tree chain when splitting adds cold starts without enabling parallelism. High-complexity items remain standalone.

### Verification-item convention

Do not add a trailing test-only item by default. Each builder verifies its own slice and finalization runs the authoritative suite once. Put a cheap mechanical post-merge invariant on the owning item as a one-line `finalize_check`.

Create a `kind: test` item only when verification itself requires real reasoning, such as a computed cross-surface invariant or a genuinely new broad visual smoke surface. It depends on all relevant implementation items, stays capped, and does not rerun the full final gate.

### Optional design record

Create a design record only when a high-complexity item benefits from up-front decisions. Include decision, choice, rationale, domain model when applicable, technical approach, context and ownership assumptions, risks, mitigations, and implementation checklist. A design record is never a mandatory pause or permission gate.

## Pure-scribe fan-out

The planner makes all decisions before dispatch.

1. Build a complete immutable decision record for each work item, including every required and optional template field.
2. In one parallel round, call `spawn_agent` once per output path targeting the `specsmd_inferno_writer` custom agent. Writers run on `gpt-5.6-terra` with `high` reasoning.
3. Each assignment contains exactly one decision record, the canonical work-item template path, and one output path. No writer receives project-discovery work.
4. Use `wait_agent` until every writer returns.
5. Validate every `written` result and parse each resulting frontmatter. For a missing or failed artifact, use `followup_task` once with the exact missing field or render error. A second failure blocks the state update and is reported.
6. Only after all files validate, update `.specs-inferno/state.yaml` once with the work-item list and intent metadata. Writers never touch state.

## Validation

Before handoff:

1. Parse state and every new frontmatter block.
2. Confirm every manifest field, editable path, dependency, complexity, and verification command.
3. Confirm item dependencies and intent dependencies are acyclic.
4. Confirm no two supposedly parallel items overlap editable ownership.
5. Confirm design contracts cite an exact source.
6. Run the canonical decomposition contract test when its prerequisites are available:

   ```sh
   node --test .specsmd/inferno/agents/planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs
   ```

## Handoff and stop

Print:

- intent title and id;
- ordered work items with complexity and dependency summary;
- which items can start in parallel;
- assumptions, risks, or deferred decisions worth reviewing;
- whether a small serial plan may be cheaper to implement directly from the captured specs.

For `autonomy.level: full`, print the summary and stop. For `review`, add one concise “Worth a look before you build” block containing only urgent or questionable points, invite refinement, and stop. Never start builders or route directly into execution.

End by saying the plan is ready and can be built later with `$specsmd-inferno`.
