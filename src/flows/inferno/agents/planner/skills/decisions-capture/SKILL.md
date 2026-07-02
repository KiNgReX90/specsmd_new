---
name: decisions-capture
description: Do the inception homework once - trimmed requirements plus a dated decisions and load-bearing caveats ledger - so decomposition writes work items that cannot silently drop a fact.
version: 1.0.0
---

<objective>
Between intent capture and decomposition, produce the two ledgers that make INFERNO's
work items trustworthy: a trimmed **requirements** doc (the written scope) and a
**decisions & caveats** ledger (dated decisions, load-bearing open questions/caveats,
release gates). These are written ONCE here; decomposition links and inlines them rather
than restating, and never builds blind to a caveat.
</objective>

<note>
INFERNO's lean brief-then-items shape is cheap but lossy: when a load-bearing caveat
(e.g. "no DB column exists for X — do NOT add a NOT NULL column; confirm with a data
specialist") is flattened away during decomposition, a builder reinvents it and ships a
real defect. This skill is the turbo-a fix: capture the caveat as a first-class, dated
ledger entry up front, so the caveat-survival check in decomposition can prove every one
of them reached a work item. It is the AI-DLC "do the thinking first" discipline, kept to
two lean files.
</note>

<triggers>
  - An intent brief exists but has no `requirements.md` / `decisions.md` yet
  - Chained automatically from `intent-capture` (capture → decisions → decompose)
</triggers>

<degrees_of_freedom>
  **MEDIUM** - Investigate the brief and the codebase to ground decisions in fact, but do
  not re-open the captured intent. The goal is a faithful, lean ledger, not a redesign.
</degrees_of_freedom>

<llm critical="true">
  <mandate>Write each load-bearing fact ONCE. The ledgers are the single source; work items link/inline, never re-derive.</mandate>
  <mandate>A caveat is any fact that, if dropped or guessed, causes a real build defect (a phantom column, a wrong rounding mode, a forward-only rule applied backward). Surface these explicitly — they are the whole point.</mandate>
  <mandate>NEVER silently resolve an open question that the evidence does not settle. Record it as `OPEN` with a conservative build rule, so the builder is told exactly what NOT to assume.</mandate>
  <mandate>When production intent-capture ran, its Stage 2 deep-dive answers (edge cases, error handling, data/storage, integrations, NFRs) arrive as raw inputs — turn them into concrete FR/NFR lines, dated decisions, and load-bearing caveats HERE. They belong in the ledger, not the brief.</mandate>
  <mandate>Honor `mode` (from `.specs-inferno/config.yaml`): under `production`, pause once to confirm OPEN caveats and any decision you had to make on the user's behalf; under `autonomous`, decide with best judgment, mark genuinely unresolved items `OPEN`, and note them.</mandate>
  <mandate>Keep it lean: a trimmed requirements doc and a decisions ledger, not an AI-DLC document tree. No system-context, no impact-analysis, no per-unit briefs.</mandate>
</llm>

<flow>
  <step n="1" title="Load intent + investigate">
    <action>Read `.specs-inferno/intents/{intent-id}/brief.md` (goal, users, problem, success criteria, constraints, notes).</action>
    <action>Investigate the codebase for the facts the build will turn on: the real files/columns/APIs involved, existing patterns, house idioms, and anything the brief asserts that the code can confirm or contradict.</action>
    <action>If production intent-capture ran, its Stage 2 deep-dive answers (edge cases, error handling, data/storage, integrations, NFRs) are in this session's context — treat them as primary source material for the requirements and caveats below.</action>
    <append_mode>
      In APPEND mode (an `integrate` outcome from intent-capture), `requirements.md` and
      `decisions.md` already exist for the target intent. You are EXTENDING them: add the
      new scope's requirements and any new decisions/caveats; never rewrite or drop the
      existing entries.
    </append_mode>
  </step>

  <step n="2" title="Trim requirements">
    <action>Derive the written scope as functional (FR) and non-functional (NFR) requirements, each one line, plus an explicit out-of-scope list. This is the contract decomposition must cover — no more, no less.</action>
    <action>Do NOT restate the brief's prose. Requirements are testable statements, not narrative.</action>
  </step>

  <step n="3" title="Capture decisions & caveats" critical="true">
    <action>Record **dated key decisions**: the choice, a one-line rationale (cite the code/file when the code is leading), and status (`decided` or `OPEN`).</action>
    <action>Record **open questions / caveats** — the load-bearing facts. For each: an id (e.g. `C-1`, `OQ-012`), a status (`OPEN` | `resolved`), and a single build rule stating exactly what the builder must do or must NOT assume. A caveat with no build rule is useless — always give the rule.</action>
    <action>Record **release gates**: the hard conditions that must hold before the intent can close (parity checks, idiom gates, "big-bang, no feature flag", etc.).</action>
    <action>Apply `mode` from `.specs-inferno/config.yaml` (resolve as: `mode` present → use it; else legacy `autonomy.level` maps `review` → `production`, `full` → `autonomous`; neither present → `production`):
      - `production` → pause ONCE to confirm OPEN caveats and any decision you made on the user's behalf. Then continue.
      - `autonomous` → decide with best judgment, mark genuinely unresolved items `OPEN` with a conservative rule, and continue without pausing.
    </action>
  </step>

  <step n="4" title="Write the ledgers">
    <action>Render `requirements.md` from `templates/requirements.md.hbs` → `.specs-inferno/intents/{intent-id}/requirements.md`.</action>
    <action>Render `decisions.md` from `templates/decisions.md.hbs` → `.specs-inferno/intents/{intent-id}/decisions.md`.</action>
    <action>Do NOT touch `state.yaml` here — these are intent-scoped docs, not state. (Decomposition owns the work-items list in state.)</action>
  </step>

  <step n="5" title="Transition">
    <output>
      **Decisions & requirements captured** for "{intent-title}".

      - Requirements: .specs-inferno/intents/{intent-id}/requirements.md
      - Decisions & caveats: .specs-inferno/intents/{intent-id}/decisions.md ({n} caveats, {m} OPEN)

      ---

      Decomposing into work items now.
    </output>
    <action critical="true">Immediately invoke `work-item-decompose`. INFERNO always chains capture → decisions → decompose; never ask the user to confirm this transition. In APPEND mode, invoke decomposition in APPEND mode against the existing target intent id.</action>
    <invoke_skill>work-item-decompose</invoke_skill>
  </step>
</flow>

<output_artifacts>

  | Artifact | Location | Template |
  |----------|----------|----------|
  | Requirements | `.specs-inferno/intents/{id}/requirements.md` | `./templates/requirements.md.hbs` |
  | Decisions & Caveats | `.specs-inferno/intents/{id}/decisions.md` | `./templates/decisions.md.hbs` |
</output_artifacts>

<success_criteria>
  <criterion>Requirements captured as one-line FR/NFR plus an explicit out-of-scope list</criterion>
  <criterion>Every load-bearing caveat recorded with an id, a status, and an exact build rule (what to do / what NOT to assume)</criterion>
  <criterion>Open questions the evidence does not settle are marked OPEN with a conservative rule — never silently resolved</criterion>
  <criterion>Key decisions are dated with a one-line rationale; release gates listed</criterion>
  <criterion>In `production`, the intent-capture Stage 2 deep-dive answers are folded into FR/NFR, decisions, and caveats (not left in the brief)</criterion>
  <criterion>`mode` honored: production pauses once for OPEN caveats; autonomous decides-and-notes</criterion>
  <criterion>Both ledgers saved to the intent folder; state.yaml untouched</criterion>
  <criterion>Decomposition invoked immediately (APPEND mode preserved when integrating)</criterion>
</success_criteria>
