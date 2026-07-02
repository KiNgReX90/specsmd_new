---
name: inception-import
description: Convert a completed AI-DLC memory-bank intent into an INFERNO intent brief plus one contract-valid work item per user story, flattening units/bolts away and linking each story as required context.
version: 1.0.0
---

<objective>
Read a COMPLETED AI-DLC memory-bank intent and emit INFERNO artifacts: one
`brief.md` (from requirements + system-context) and one contract-valid
`work-items/{story-id}.md` per user story, written into `.specs-inferno/`. This
is a FLATTENING, not a translation — units and bolts collapse away; stories
survive as first-class work items whose prose is LINKED, never re-summarized.
</objective>

<triggers>
  - User runs the inception→INFERNO bridge command on a completed memory-bank intent
  - A memory-bank intent exists (requirements + units/stories) and the user wants to build it with `/specsmd-inferno`
</triggers>

<degrees_of_freedom>
  **LOW for structure, MEDIUM for resolution.** The mapping rules, the output
  templates, and the contract are FIXED — do not invent fields, templates, or a
  new authoring path. Path resolution and `kind`/`complexity` inference are
  reasoned per story against the real codebase.
</degrees_of_freedom>

<llm critical="true">
  <mandate>Run inception EXACTLY as it is — never edit memory-bank artifacts. This skill only READS them.</mandate>
  <mandate>The deterministic parse is `scripts/extract-memory-bank-intent.cjs` — run it; never hand-parse story files in prose.</mandate>
  <mandate>One story → one work item. Each story file is LINKED in `context.required`; its prose is NEVER copied or re-summarized into the work-item body.</mandate>
  <mandate>Every emitted work item MUST pass the orchestrator's `team-scheduler.cjs` `validateWorkItem` contract. Validate BEFORE writing.</mandate>
  <mandate>A story that cannot be resolved to a real editable target is FLAGGED to the user and NOT emitted. Never emit an invalid or placeholder-path work item.</mandate>
  <mandate>units.md, unit-brief.md, bolts, and construction-stage docs are DISCARDED — never carried into INFERNO artifacts.</mandate>
  <mandate>Render from the EXISTING templates only: `work-item-decompose/templates/work-item.md.hbs` and `intent-capture/templates/brief.md.hbs`. Do not author a new template.</mandate>
  <mandate>Fan out the actual file WRITING via `specsmd-inferno-writer` scribes — the same path as `work-item-decompose`. Scribes make no decisions.</mandate>
  <mandate>Never reference the FIRE artifact namespace. All output lands under `.specs-inferno/`.</mandate>
</llm>

<the_mapping>
  Authoritative flattening (see `docs/inception-to-inferno-eval-strategy.md` Part A):

  | AI-DLC artifact | → INFERNO | Notes |
  |---|---|---|
  | `requirements.md` (goal/users/problem) + `system-context.md` | `intents/<id>/brief.md` | actors/externals → constraints / notes |
  | Story `stories/NNN-*.md` | Work item `work-items/<story-id>.md` | 1 story ≈ 1 item |
  | Story acceptance criteria | work-item `## Acceptance Criteria` | carried verbatim from the model |
  | Story FILE itself | `context.required` entry | **linked, never re-summarized** |
  | Story Requires/Depends edges | work-item `depends_on` | within-intent ordering only |
  | Unit | `ownership.editable` partition + grouping label | unit-brief doc is **discarded** |
  | Bolt / bolt-plan | *discarded* | INFERNO recomputes the build frontier |
  | Unit-brief "technical context" prose | `context.patterns` / `context.tests` targets | resolved to concrete paths (see resolution) |
  | Story/unit type + AC scope | work-item `kind` + `complexity` | inferred |
</the_mapping>

<the_contract>
  `team-scheduler.cjs` `validateWorkItem` refuses any item that fails:

- `context.required` — non-empty; real paths with reasons.
- `ownership.editable` — non-empty; real paths.
- `context.patterns` — REQUIRED when `kind ∈ {behavior, architecture, api, ui}`.
- `context.tests` — REQUIRED unless `kind ∈ {docs-only, config-only}`.

  Validate each decision record against these rules in step 4 BEFORE dispatching
  any scribe. Anything that fails is either fixed (resolve the missing path) or
  the story is FLAGGED and SKIPPED — never written invalid.
</the_contract>

<flow>
  <step n="1" title="Locate + extract the memory-bank intent (deterministic)">
    <action>Confirm the target `memory-bank/intents/{intent-id}/` exists and is COMPLETE (has `requirements.md` and at least one `units/*/stories/*.md`). If not, stop and tell the user which artifact is missing.</action>
    <action>Run the extraction core to get the structured model — do not parse story files by hand:</action>
    ```bash
    node <skill-dir>/scripts/extract-memory-bank-intent.cjs  # imported; see below
    ```
    <note>Programmatic use: `const { extractMemoryBankIntent } = require('./scripts/extract-memory-bank-intent.cjs'); const model = extractMemoryBankIntent(intentDir);`. The model is `{ intent: {id, slug, requirements, system_context}, units: [...], stories: [{id, frontmatter_id, unit, title, priority, status, acceptance_criteria[], depends_on[], body, source_path}] }`. `source_path` is relative to the intent dir — it is the exact `context.required` link target. `body` is the story prose you LINK, never paste.</note>
  </step>

  <step n="2" title="Render the intent brief">
    <action>Derive the INFERNO brief from `model.intent`: goal/problem/success-criteria from `requirements`, actors/externals from `system_context` → constraints / notes.</action>
    <action>Produce a complete decision record for `intent-capture/templates/brief.md.hbs` (id = `model.intent.id`, title, goal, users, problem, success_criteria[], constraints[], notes). Output path: `.specs-inferno/intents/{intent-id}/brief.md`.</action>
    <action>The brief is a SUMMARY of requirements (the requirements doc is the source, not a linked context file) — but story prose is never summarized; that is the work items' job via `context.required`.</action>
  </step>

  <step n="3" title="Build one work-item decision record per story (planner reasoning)">
    <critical>ALL reasoning happens HERE, by you, BEFORE any file is written. For EACH story in `model.stories` produce a COMPLETE decision record for `work-item-decompose/templates/work-item.md.hbs`.</critical>
    <substep title="Identity + grouping">
      `id` = story `id`; `title` = story `title`; `intent` = intent id;
      `mode: autopilot`; `status: pending`. Record the story's `unit` as a
      grouping label (used to partition ownership in the next substep).
    </substep>
    <substep title="Acceptance criteria">
      Carry `story.acceptance_criteria` VERBATIM into `## Acceptance Criteria`.
      Do not reword.
    </substep>
    <substep title="Description = a pointer, not a re-summary">
      The description is one line that NAMES the deliverable and defers to the
      linked story for detail (e.g. "Implement the {title} story; see the linked
      story file for the full narrative and edge cases."). NEVER paste or
      paraphrase `story.body`.
    </substep>
    <substep title="depends_on">
      Use `story.depends_on` directly (already normalized to in-intent story
      ids). Drop any edge that does not match an emitted work-item id (a skipped
      story, or a cross-intent reference) and note the drop.
    </substep>
    <substep title="kind + complexity (inferred)">
      Infer `kind ∈ {behavior, architecture, api, ui, test, docs-only,
      config-only}` from the story type and AC scope (UI/tree/render → `ui`;
      endpoint/contract → `api`; cross-cutting/structural → `architecture`;
      logic/data → `behavior`; pure docs/config → the `*-only` kinds). Infer
      `complexity ∈ {low, medium, high}` from AC count + breadth (single file /
      known pattern → low; multi-file feature → medium; architectural / core →
      high).
    </substep>
  </step>

  <step n="4" title="Resolve concrete paths + enforce the contract">
    <action>For each record resolve REAL paths against the actual codebase, in this order: (1) PREFER any concrete paths already pinned in the story's frontmatter or body by `/resolve-inception-docs`; (2) otherwise resolve from the unit grouping + AC against the real tree (the unit becomes an `ownership.editable` partition — the directory/files that unit owns).</action>
    <action>`context.required` MUST include the story file (`{story.source_path}` resolved under `memory-bank/intents/{intent-id}/`) with a reason like "source story: full narrative + acceptance criteria"; add the nearest real implementation anchor if known.</action>
    <action>`context.patterns`: REQUIRED for `behavior/architecture/api/ui` — point at an existing sibling that models the convention (resolved from the codebase or the discarded unit-brief's tech-context prose). `context.tests`: REQUIRED unless `docs-only`/`config-only` — point at the test target/suite.</action>
    <action>`ownership.editable`: the concrete editable surface for this story's unit partition — non-empty, real paths, NEVER a placeholder like `path/to/file`.</action>
    <action critical="true">
      Run each record through `team-scheduler.cjs` `validateWorkItem` (require it from `../../../orchestrator/skills/orchestrate/scripts/team-scheduler.cjs`). If `valid` is false: try once to resolve the missing piece; if still unresolvable, ADD the story to the flagged list and DROP its record. Never write an item that fails the contract.
    </action>
  </step>

  <step n="5" title="Report unresolved stories">
    <output>
      ## Conversion plan for "{intent-title}"

      **From**: memory-bank/intents/{intent-id} ({unit-count} units, {story-count} stories)
      **Emitting**: 1 brief + {emitted-count} work items

      {if flagged}
      **⚠ {flagged-count} stories could not be resolved to a real editable target and were SKIPPED** (resolve their paths — e.g. via `/resolve-inception-docs` — and re-run):
      {for each flagged}- {story-id}: {reason}{/for}
      {/if}

      {for each emitted item}
      - **{id}** ({kind}/{complexity}) — owns {ownership.editable}; depends_on {depends_on}; links {story.source_path}
      {/for}

      Proceed to write these artifacts? [Y/n/edit]
    </output>
  </step>

  <step n="6" title="Write artifacts (parallel scribe fan-out)">
    <critical>ALL content was decided in steps 2–4. Writing is fanned out to scribes purely for speed — scribes make NO decisions. This mirrors `work-item-decompose` step 8.</critical>
    <check if="approved">
      <substep n="6.1" title="Create target dirs">
        Create `.specs-inferno/intents/{intent-id}/` and `.specs-inferno/intents/{intent-id}/work-items/`.
      </substep>
      <substep n="6.2" title="Dispatch scribes in parallel">
        In ONE round, dispatch one `specsmd-inferno-writer` subagent for the
        brief and one per emitted work item. Each dispatch prompt contains ONLY:
        the decision record, the template path
        (`intent-capture/templates/brief.md.hbs` for the brief,
        `work-item-decompose/templates/work-item.md.hbs` for items), and the
        output path. No policy restatement — the installed writer agent body is
        its system prompt. Set each dispatch `model` override to `models.writer`
        from `.specs-inferno/config.yaml`; fall back to `models.cheap`, then to
        no override (host default). Disjoint output paths mean writers never
        collide.
      </substep>
      <substep n="6.3" title="Collect results">
        Each scribe returns `status: written | failed` with the path it wrote.
        Any `failed` is YOUR bug in the decision record — fix the record and
        re-dispatch that one file. Never accept a partial or invented artifact.
      </substep>
      <substep n="6.4" title="Update state (planner only)">
        After ALL scribes return `written`, YOU — not any scribe — register the
        intent and its work-items list in `.specs-inferno/state.yaml` once.
        Scribes never touch `state.yaml`.
      </substep>
      <substep n="6.5" title="Fallback (host without subagents)">
        On a host without subagents, render each artifact from its template and
        write the files yourself, sequentially, then do 6.4.
      </substep>
    </check>
  </step>

  <step n="7" title="Transition">
    Conversion ends at writing the artifacts — it never starts the build.
    <output>
      **{emitted-count} work items + 1 brief created** for "{intent-title}" under `.specs-inferno/intents/{intent-id}/`.
      {if flagged}{flagged-count} stories were skipped (see above) — resolve their paths and re-run to add them.{/if}

      Start the build with `/specsmd-inferno` when you're ready.
    </output>
  </step>
</flow>

<output_artifacts>

  | Artifact | Location | Template |
  |----------|----------|----------|
  | Intent brief | `.specs-inferno/intents/{intent-id}/brief.md` | `../intent-capture/templates/brief.md.hbs` |
  | Work item (per story) | `.specs-inferno/intents/{intent-id}/work-items/{story-id}.md` | `../work-item-decompose/templates/work-item.md.hbs` |
</output_artifacts>

<success_criteria>
  <criterion>Memory-bank intent read via the deterministic extraction core; its artifacts never modified</criterion>
  <criterion>Exactly one work item emitted per resolvable story; one brief emitted from requirements + system-context</criterion>
  <criterion>Each work item links its story file in `context.required`; story prose never copied or re-summarized</criterion>
  <criterion>Acceptance criteria carried verbatim; `depends_on` mapped from story Requires edges</criterion>
  <criterion>Unit → `ownership.editable` partition + grouping label; units/bolts/unit-briefs not carried into INFERNO</criterion>
  <criterion>Every emitted work item passes `team-scheduler.cjs` `validateWorkItem` (validated before writing)</criterion>
  <criterion>Unresolvable stories flagged to the user and skipped — never emitted invalid</criterion>
  <criterion>Rendered from the existing brief + work-item templates; no new template invented</criterion>
  <criterion>File writing fanned out to `specsmd-inferno-writer` scribes; state.yaml updated by the planner alone</criterion>
  <criterion>No FIRE-namespace references anywhere in the skill</criterion>
</success_criteria>
