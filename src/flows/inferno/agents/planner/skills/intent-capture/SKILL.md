---
name: intent-capture
description: Capture user intent through guided conversation. Exploratory phase with high degrees of freedom.
version: 1.0.0
---

<objective>
Capture user intent through guided conversation.
</objective>

<triggers>
  - No active intent exists
  - User wants to start something new
</triggers>

<degrees_of_freedom>
  **HIGH** - This is a creative, exploratory phase. Ask open-ended questions. Don't constrain prematurely.
</degrees_of_freedom>

<llm critical="true">
  <mandate>NEVER assume requirements - ALWAYS ask clarifying questions</mandate>
  <mandate>Capture the "what" and "why" - leave the "how" for decomposition</mandate>
  <mandate>Let user describe freely - don't interrupt</mandate>
</llm>

<flow>
  <step n="1" title="Initial Question">
    <ask>What do you want to build?</ask>
    <listen>Let user describe freely. Don't interrupt.</listen>
  </step>

  <step n="2" title="Elicit Context">
    <action>Based on response, ask follow-up questions:</action>

    <question if="unclear who benefits">
      Who is this for? Who will use this feature?
    </question>

    <question if="unclear problem">
      What problem does this solve? What's painful today?
    </question>

    <question if="unclear scope">
      What's the minimum that would be valuable? What can wait?
    </question>

    <question if="unclear constraints">
      Any technical constraints? Existing systems to integrate with?
    </question>

    <question if="unclear success">
      How will you know this is working? What does success look like?
    </question>
  </step>

  <step n="3" title="Summarize Understanding">
    <output>
      Let me make sure I understand:

      **Goal**: {summarized goal}

      **Users**: {who benefits}

      **Problem**: {what pain this solves}

      **Success Criteria**:
      - {criterion 1}
      - {criterion 2}
      - {criterion 3}

      **Constraints**:
      - {constraint 1}
      - {constraint 2}

      Is this accurate? [Y/n/edit]
    </output>
    <check if="response == n or edit">
      <action>Ask specific clarifying questions</action>
      <goto step="3"/>
    </check>
  </step>

  <step n="3b" title="Cross-Intent Overlap Check" critical="true">
    <objective>Before this becomes a separate intent, reconcile it against work that is already queued. INFERNO can hold several intents that are captured but not yet built; a new one must never be added blind to them — it gets integrated into, sequenced behind, or run independently of the open intents, on purpose.</objective>

    <action>Read `.specs-inferno/state.yaml` and collect every intent whose status is NOT `completed` (i.e. `pending` or `in_progress`) — the "open" intents. For each, read its `.specs-inferno/intents/{id}/brief.md`. (No open intents → skip straight to step 4, this is independent by default.)</action>
    <action>Compare the new intent's goal / problem / success criteria against each open intent and classify the relationship:</action>

    <relationship name="independent">No meaningful scope overlap and no shared subsystem. → Proceed normally: separate intent, no dependency.</relationship>
    <relationship name="integrate">The new request is the same body of work as an open intent, or a subset/extension of it (same goal, same surface). → Do NOT create a separate intent; fold the new scope into that intent (see &lt;integrate_outcome/&gt;). Only an intent with status `pending` may be integrated into — never one that is `in_progress` (another run owns it; fall back to `depend` or surface).</relationship>
    <relationship name="depend">A distinct deliverable, but it builds on, consumes, or would edit the same files as an open intent and therefore must run after it. → Create the new intent, but record an intent-level dependency (see &lt;depend_outcome/&gt;).</relationship>
    <relationship name="conflict">The new intent and an open intent pull the same subsystem in incompatible directions (one would undo or contradict the other). → ALWAYS surface to the user regardless of autonomy.level; propose superseding one, reconciling the briefs, or sequencing. Never auto-resolve a true conflict.</relationship>

    <action>Act per `autonomy.level` (`.specs-inferno/config.yaml`; file or key absent → `review`):
      - `review` → when the relationship is anything other than `independent`, state the finding (which open intent, the evidence, your recommended action) and pause ONCE for the user to confirm or redirect before writing anything.
      - `full` → apply your best judgment and record the decision in the brief's Notes; no pause. EXCEPTION: a `conflict` always pauses regardless of level.
    </action>

    <integrate_outcome>
      Skip step 4 entirely — no new brief, no new intent id, no new state entry. Extend the target intent's `brief.md` (Goal / Success Criteria / Notes) with the new scope, then route decomposition at that EXISTING intent in APPEND mode (the work-item-decompose skill adds items to an intent that already has some; the new items get `depends_on` wired to the target's existing items where the work genuinely builds on them).
    </integrate_outcome>

    <depend_outcome>
      Continue to step 4, then in step 5 record the dependency: set the new intent's `depends_on: [<prereq-intent-id>, ...]` on its state.yaml entry AND in its brief front-matter. List ONLY open intents this one truly must follow. Never point `depends_on` at a `completed` intent (already satisfied) and never form a cycle (an open intent already pointing back at this one).
    </depend_outcome>
  </step>

  <step n="4" title="Generate Intent Brief">
    <action>Create intent ID from title (kebab-case)</action>
    <action>Generate intent brief using template: templates/brief.md.hbs</action>
    <action>Create directory: .specs-inferno/intents/{intent-id}/</action>
    <action>Save: .specs-inferno/intents/{intent-id}/brief.md</action>
  </step>

  <step n="5" title="Update State">
    <action>Add intent to state.yaml</action>
    <action>Set intent status to "pending" (the orchestrator claims it and sets "in_progress" at selection)</action>
    <action>If step 3b produced a `depend` outcome, add `depends_on: [<prereq-intent-id>, ...]` to this intent's state.yaml entry. Omit the field for `independent` intents. (Integrate outcomes never reach this step — they wrote into an existing intent.)</action>
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
  <criterion>User intent fully understood through dialogue</criterion>
  <criterion>Goal, users, problem clearly captured</criterion>
  <criterion>Success criteria defined</criterion>
  <criterion>Constraints identified</criterion>
  <criterion>Intent brief saved to correct location</criterion>
  <criterion>State.yaml updated with new intent</criterion>
  <criterion>New intent reconciled against all open (non-completed) intents: integrated, made to depend on, or confirmed independent — never added blind</criterion>
  <criterion>Any intent-level `depends_on` recorded in both state.yaml and the brief, points only at non-completed intents, and forms no cycle</criterion>
</success_criteria>
