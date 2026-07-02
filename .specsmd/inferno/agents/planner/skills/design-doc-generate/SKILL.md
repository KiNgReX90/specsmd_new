---
name: design-doc-generate
description: Generate design documents for high-complexity work items. Optional planner capability; never a mandatory gate.
version: 1.0.0
---

<objective>
Generate design documents for high-complexity work items when an up-front design genuinely helps. Optional — never a flow-halting gate.
</objective>

<triggers>
  - Work item has complexity: high AND an up-front design doc genuinely helps
  - The planner opts to capture key decisions before the build

This skill is an OPTIONAL planner capability, not a mandatory gate. Generating a design doc never halts the planning → build flow: under `mode: production` the only pause is the single urgent-only review point in the planner's `<handoff_format>`; under `autonomous` there is none. Surface any genuinely open design question there rather than blocking on a separate approval.
</triggers>

<degrees_of_freedom>
  **LOW** - Follow the design doc structure precisely. Decisions must have rationale.
</degrees_of_freedom>

<llm critical="true">
  <mandate>Document DECISIONS with RATIONALE, not just choices</mandate>
  <mandate>Keep concise - enough detail to implement, no more</mandate>
  <mandate>Include risks upfront - don't hide complexity</mandate>
  <mandate>If design choices affect execution slicing, document context and ownership assumptions</mandate>
</llm>

<flow>
  <step n="1" title="Analyze Work Item">
    <action>Read work item from .specs-inferno/intents/{intent-id}/work-items/{id}.md</action>
    <action>Identify key design decisions needed</action>
    <action>Assess domain modeling needs</action>
    <action>Identify integration points</action>
  </step>

  <step n="2" title="Gather Context">
    <action>Review project standards (.specs-inferno/standards/)</action>
    <action>Check existing codebase patterns</action>
    <action>Identify similar implementations to reference</action>
  </step>

  <step n="3" title="Draft Key Decisions">
    <action>For each decision point:</action>
    <substep>Identify options considered</substep>
    <substep>Evaluate trade-offs</substep>
    <substep>Select recommended choice</substep>
    <substep>Document rationale</substep>

    <output_format>
      | Decision | Choice | Rationale |
      |----------|--------|-----------|
      | ... | ... | ... |
    </output_format>
  </step>

  <step n="4" title="Define Domain Model" if="has_domain_complexity">
    <action>Identify entities (things with identity)</action>
    <action>Identify value objects (immutable values)</action>
    <action>Identify domain events (if event-driven)</action>
    <action>Map relationships</action>
  </step>

  <step n="5" title="Design Technical Approach">
    <action>Create component diagram (ASCII)</action>
    <action>Define API contracts (if applicable)</action>
    <action>Specify database changes (if applicable)</action>
    <action>Document data flow</action>
    <action>Document context and ownership assumptions when they affect work-item boundaries</action>
  </step>

  <step n="6" title="Identify Risks">
    <action>List potential risks</action>
    <action>Assess impact (high/medium/low)</action>
    <action>Propose mitigations</action>

    <output_format>
      | Risk | Impact | Mitigation |
      |------|--------|------------|
      | ... | ... | ... |
    </output_format>
  </step>

  <step n="7" title="Create Implementation Checklist">
    <action>Break down into implementation steps</action>
    <action>Order by dependency</action>
    <action>Keep granular but not excessive</action>
  </step>

  <step n="8" title="Generate and Save Design Doc">
    <action>Generate design doc using template: templates/design.md.hbs</action>
    <action>Save to: .specs-inferno/intents/{intent-id}/work-items/{id}-design.md</action>
    <action>Update state.yaml</action>
    <note>Do NOT block on a separate approval gate. This skill never halts the planning → build flow. If a genuine design question, risky assumption, or ambiguity remains open, carry it into the planner's single urgent-only review point (`<handoff_format>` under `mode: production`) so the user can weigh in there — not via a per-doc checkpoint.</note>
  </step>
</flow>

<output_artifacts>

  | Artifact | Location | Template |
  |----------|----------|----------|
  | Design Doc | `.specs-inferno/intents/{intent-id}/work-items/{id}-design.md` | `./templates/design.md.hbs` |
</output_artifacts>

<success_criteria>
  <criterion>Work item analyzed for design decisions</criterion>
  <criterion>Key decisions documented with rationale</criterion>
  <criterion>Domain model defined (if applicable)</criterion>
  <criterion>Technical approach specified</criterion>
  <criterion>Context and ownership assumptions documented when relevant</criterion>
  <criterion>Risks identified with mitigations</criterion>
  <criterion>Implementation checklist created</criterion>
  <criterion>Design doc saved to correct location (no blocking approval gate; open questions carried to the planner's urgent-only review point)</criterion>
</success_criteria>
