---
name: intent-capture
description: Capture intent from the statement, the specs and the live code. Exploratory phase with high degrees of freedom.
version: 1.2.0
---

<objective>
Capture intent from the statement, the specs and the live code.
</objective>

<triggers>
  - No active intent exists
  - User wants to start something new
</triggers>

<degrees_of_freedom>
  **HIGH** - This is a creative, exploratory phase. Read widely before deciding. Don't constrain prematurely.
</degrees_of_freedom>

<llm critical="true">
  <mandate>NEVER assume requirements. Settle them from the project's specs and the live code; what they leave open goes to the oracle, never to a question for the user (2026-09-02)</mandate>
  <mandate>Capture the "what" and "why" - leave the "how" for decomposition</mandate>
  <mandate>Read the whole statement, and the doc it points at, before grounding it</mandate>
</llm>

<flow>
  <step n="1" title="The Statement">
    <action>Read the intent statement whole: the user's words, or the doc they point at. That statement is the request; nothing is asked back.</action>
  </step>

  <step n="2" title="Elicit Context from the Specs">
    <action>Answer the capture questions from the project's specs and the live code, never by asking:</action>

    <question if="unclear who benefits">
      Who is this for? The project's reader or persona doc, and its product doc.
    </question>

    <question if="unclear problem">
      What problem does this solve? The statement, its source doc (an audit, a finding card, a note), and the live code it names.
    </question>

    <question if="unclear scope">
      What is the minimum that would be valuable? The statement's own boundary, then the coupling rule of step 3c.
    </question>

    <question if="unclear constraints">
      Any technical constraints? The host project's standing rules (`CLAUDE.md` or `AGENTS.md` and whatever they point to), its design doc, and its reference material for anything an external rule governs.
    </question>

    <question if="unclear success">
      How will we know this is working? The instrument that measures it: a test file, an integration case id, a command and the value it must show.
    </question>

    <action>What none of these settles is an oracle question (one paragraph: the question, the readings, what was measured, the paths). A planner that can spawn asks `specsmd-inferno-oracle` now; a delegated planner returns it as `oracle:` in its result. Never a question for the user.</action>
  </step>

  <step n="3" title="Summarize Understanding">
    <output>
      **Goal**: {summarized goal}

      **Users**: {who benefits}

      **Problem**: {what pain this solves}

      **Success Criteria**:
      - {criterion 1, with its instrument and the value it must show}
      - {criterion 2}
      - {criterion 3}

      **Constraints**:
      - {constraint 1}
      - {constraint 2}
    </output>
    <action>This summary is the brief's first draft. There is no confirmation prompt.</action>
  </step>

  <step n="3b" title="Cross-Intent Overlap Check" critical="true">
    <objective>Before this becomes a separate intent, reconcile it against work that is already queued. INFERNO can hold several intents that are captured but not yet built; a new one must never be added blind to them — it gets integrated into, sequenced behind, or run independently of the open intents, on purpose.</objective>

    <action>Read `.specs-inferno/state.yaml` and collect every intent whose status is NOT `completed` (i.e. `pending` or `in_progress`) — the "open" intents. For each, read its `.specs-inferno/intents/{id}/brief.md`. (No open intents → skip straight to step 4, this is independent by default.)</action>
    <action>Compare the new intent's goal / problem / success criteria against each open intent and classify the relationship:</action>

    <relationship name="independent">No meaningful scope overlap and no shared subsystem. → Proceed normally: separate intent, no dependency.</relationship>
    <relationship name="integrate">The new request is the same body of work as an open intent, or a subset/extension of it (same goal, same surface). → Do NOT create a separate intent; fold the new scope into that intent (see &lt;integrate_outcome/&gt;). Only an intent with status `pending` may be integrated into — never one that is `in_progress` (another run owns it; fall back to `depend` or surface).</relationship>
    <relationship name="depend">A distinct deliverable, but it builds on, consumes, or would edit the same files as an open intent and therefore must run after it. → Create the new intent, but record an intent-level dependency (see &lt;depend_outcome/&gt;).</relationship>
    <relationship name="conflict">The new intent and an open intent pull the same subsystem in incompatible directions (one would undo or contradict the other). → Read both briefs and the specs; when they settle it, supersede, reconcile or sequence and note the decision in the brief; when they do not, it goes to the oracle (asked now, or returned as an `oracle:` block by a delegated planner) and nothing is written for the conflicting scope until the decision is back. Never a pause, never a note in place of a decision.</relationship>

    <action>Act without a pause in every mode, whatever `autonomy.level` says: apply your best judgment where the briefs and the specs settle the relationship and record the decision (which open intent, the evidence, the action) in the brief's Notes; a `conflict` they do not settle is the oracle's.</action>

    <integrate_outcome>
      Skip step 4 entirely — no new brief, no new intent id, no new state entry. Extend the target intent's `brief.md` (Goal / Success Criteria / Notes) with the new scope, then route decomposition at that EXISTING intent in APPEND mode (the work-item-decompose skill adds items to an intent that already has some; the new items get `depends_on` wired to the target's existing items where the work genuinely builds on them).
    </integrate_outcome>

    <depend_outcome>
      Continue to step 4, then in step 5 record the dependency: set the new intent's `depends_on_intents: [<prereq-intent-id>, ...]` on its state.yaml entry AND in its brief front-matter. List ONLY open intents this one truly must follow. Never point `depends_on_intents` at a `completed` intent (already satisfied) and never form a cycle (an open intent already pointing back at this one).
    </depend_outcome>
  </step>

  <step n="3c" title="One item is a one-item intent (nothing is parked)" critical="true">
    <objective>Every captured item lands in `.specs-inferno/state.yaml` as an intent, because the ledger is the only queue any session reads: the orchestrator menu is built from it, builders are dispatched from it, finalize reconciles it. A request that decomposes to ONE work item is a ONE-ITEM intent. Until 2026-08-30 this step parked such items in `.specs-inferno/quick-fixes.md` to save a cold builder dispatch. The saving was real per item and false in aggregate: three entries captured there on 2026-08-27 beside five intents were untouched three days later while the intents shipped, because nothing reads a parking file. Ownerless work is never cheap.</objective>

    <action critical="true">First apply the fix-now box: one piece of work in a few files that no open intent's work item owns, its test lands with it, no look change, no encoding of an external rule the project tracks in its reference material. An item that fits is NOT an intent: it goes back to the session that launched this planner as a `fix-now:` block in the handoff (the change, the files, the test or measurement that proves it, what you measured, and `hard` when the fix has more than one defensible shape or an unsettled cause, so that session has the oracle build it). Write no brief, no state entry and no work item for it. That session fixes it in the same turn, which is ownership, so nothing is parked (2026-09-02).</action>
    <action>Estimate the decomposition footprint of the (possibly integrated) scope BEFORE writing anything: how many work items would it yield, at what complexity (the work-item-decompose low/medium/high scale)? The count decides how many items the intent gets. It never decides whether the intent exists.</action>

    <rule critical="true">NEVER write `.specs-inferno/quick-fixes.md`, and never any other parking file, ledger note or "follow-up" list in its place. `state-transition.cjs check` reports that file as ledger drift the moment it exists, so a parked entry never survives your own post-write validation. A one-item request that is blocked, waits on another intent, shares a file with one, or can only be proved on the running binary is still a one-item intent: the wait is `depends_on_intents` (step 3b), the shared file is the collision rule of work-item-decompose step 6b, and the proof is an integration case id the project's harness runs, named in the entry comment.</rule>

    <grouping_rule>When one capture brings SEVERAL items (a fix list, a tester's finding cards, a notes doc): COUPLING decides grouping. Items touching the same surface or files are one body of work and one intent. Items with disjoint surfaces are separate intents, one item each where that is all they are. NEVER bundle unrelated small items into a catch-all intent: that widens ownership across unrelated files, blocks parallel builds, and muddies finalize.</grouping_rule>

    <cost_rule>The cost of a small item is settled at dispatch, never at capture. A fully written change spec is graded `low`, the orchestrator runs it on the cheap builder tier (`models.cheap` in `.specs-inferno/config.yaml`) and batches its verification with the rest of the run. Grade honestly and move on.</cost_rule>

    <action>The handoff readout leads with the item count of every captured intent and the `fix-now:` blocks.</action>
  </step>

  <step n="4" title="Generate Intent Brief">
    <action>Create intent ID from title (kebab-case)</action>
    <action>Generate intent brief using template: templates/brief.md.hbs</action>
    <action>Create directory: .specs-inferno/intents/{intent-id}/</action>
    <action>Save: .specs-inferno/intents/{intent-id}/brief.md</action>
  </step>

  <step n="5" title="Update State">
    <action>Add intent to state.yaml</action>
    <action critical="true">Double-quote the `title:` (and any string value) if it contains a colon-space (`: `), a space-hash (` #`), or starts with a YAML indicator char — one unquoted `: ` makes the parser fail the whole file and silently blanks the INFERNO panel. Prefer an em-dash `—` over a colon in titles.</action>
    <action>Set intent status to "pending" (the orchestrator claims it and sets "in_progress" at selection)</action>
    <action>If step 3b produced a `depend` outcome, add `depends_on_intents: [<prereq-intent-id>, ...]` to this intent's state.yaml entry. Omit the field for `independent` intents. (Integrate outcomes never reach this step — they wrote into an existing intent.)</action>
  </step>

  <step n="6" title="Transition">
    <output>
      **Intent captured**: "{intent-title}"

      Saved to: .specs-inferno/intents/{intent-id}/brief.md

      ---

      Decomposing into work items now.
    </output>
    <action critical="true">Immediately invoke the work-item-decompose skill. INFERNO ALWAYS chains capture into decomposition — never ask the user to confirm this transition. For an `integrate` outcome from step 3b, invoke it in APPEND mode against the existing target intent id (no new intent was created); otherwise invoke it for the new intent id.</action>
    <invoke_skill>work-item-decompose</invoke_skill>
  </step>
</flow>

<output_artifacts>

  | Artifact | Location | Template |
  |----------|----------|----------|
  | Intent Brief | `.specs-inferno/intents/{id}/brief.md` | `./templates/brief.md.hbs` |
</output_artifacts>

<success_criteria>
  <criterion>Intent fully understood from the statement, the specs and the live code; no question asked of the user</criterion>
  <criterion>Goal, users, problem clearly captured</criterion>
  <criterion>Success criteria defined</criterion>
  <criterion>Constraints identified</criterion>
  <criterion>Intent brief saved to correct location</criterion>
  <criterion>State.yaml updated with new intent</criterion>
  <criterion>New intent reconciled against all open (non-completed) intents: integrated, made to depend on, or confirmed independent — never added blind</criterion>
  <criterion>Every captured request landed in state.yaml as an intent, a one-item request as a one-item intent, an item inside the fix-now box returned as a `fix-now:` block; no `quick-fixes.md` or other parking file written; unrelated small items never bundled into a catch-all intent</criterion>
  <criterion>Any intent-level `depends_on_intents` recorded in both state.yaml and the brief, points only at non-completed intents, and forms no cycle</criterion>
</success_criteria>
