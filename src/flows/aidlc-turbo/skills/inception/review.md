# Skill: Review & Complete Inception

---

## Progress Display

Show at start of this skill:

```text
### Inception Progress
- [x] Intent created
- [x] Requirements gathered
- [ ] Artifacts reviewed  ← current
- [ ] Ready for Construction
```

---

## Checkpoints in This Skill

| Checkpoint | Purpose | Wait For |
|------------|---------|----------|
| Checkpoint 3 | Artifacts review (Context + Units + Stories + Bolts) | User approval |
| Checkpoint 4 | Ready for Construction | User confirmation |

---

## Goal

Ensure all inception artifacts are complete, consistent, and ready for the next phase
(Construction in full mode; the inception → INFERNO converter in lean mode).

---

## Mode Awareness (full vs lean)

This skill respects the inception mode resolved by the agent (see the agent's "Inception
Mode" section).

- **Full mode (default)**: behave exactly as documented below — verify bolts exist, all
  stories are assigned to bolts, and hand off to the Construction Agent. Nothing changes.
- **Lean mode**: **"stories authored, no bolts" is a valid completed inception.** Do NOT
  verify or require bolts, do NOT require stories to be assigned to bolts, and do NOT
  treat the absence of `.specs-aidlc-turbo/bolts/` entries as a gap. Verify only the artifacts
  that lean mode produces (requirements, system context, units.md, minimal unit-brief
  stubs, stories with acceptance criteria). The terminal handoff is to the
  **inception → INFERNO converter** (`/inception-to-inferno`), not the Construction Agent.

Wherever a step below says "Bolts" / "Bolt Plan" / "Ready for Construction," apply the
lean substitutions noted inline.

---

## Input

- **Required**: Intent name
- **Required**: All intent artifacts
- **Required**: `.specsmd/aidlc-turbo/memory-bank.yaml` - artifact schema

---

## Process

### 1. Artifact Verification

Check existence and completeness of all required artifacts:

- **Requirements**: `{intent}/requirements.md` - FR, NFR, constraints
- **System Context**: `{intent}/system-context.md` - Actors, external systems, data flows
- **Units**: `{intent}/units.md` - Unit list with purposes
- **Unit Briefs**: `{intent}/units/{unit}/unit-brief.md` - full mode: Scope, entities,
  success criteria; **lean mode: minimal grouping stub (id/label + scope hint) — verify
  only that the stub exists and parses**
- **Stories**: `{intent}/units/{unit}/stories/*.md` - Acceptance criteria
- **Bolts**: Path from `schema.bolts` - Type, stories, status — **lean mode: skip; no
  bolts are expected**

### 2. Consistency Check

Verify cross-artifact consistency:

- **Story Coverage**: All requirements traced to stories
- **Unit Independence**: No circular dependencies
- **Bolt Completeness**: All stories assigned to bolts — **lean mode: SKIP (no bolts)**
- **Type Alignment**: Bolt types match story nature — **lean mode: SKIP (no bolts)**

### Step 3: Artifacts Review

**Checkpoint 3**: Present all generated artifacts for review:

```text
### Artifacts Review

**System Context**
- Actors: {list}
- External systems: {list}
- Data flows: {summary}

**Units**
- {unit-1}: {purpose}
- {unit-2}: {purpose}

**Stories** ({n} total)
- {unit-1}: S1, S2, S3
- {unit-2}: S4, S5

**Bolt Plan** ({n} bolts)            <-- full mode only
- bolt-{unit-1}-1: Stories S1-S3
- bolt-{unit-2}-1: Stories S4-S5

Review the breakdown above. Any changes needed?
1 - Looks good, continue
2 - Need changes (specify what)
```

**Lean mode**: omit the **Bolt Plan** block entirely and instead show a closing line:
`**Bolts**: none (lean mode — stories are the terminal artifact; INFERNO recomputes grouping).`

**Wait for user response.**

---

### Step 4: Gap Resolution

If gaps are found:

```markdown
## Gaps Identified

- 🚫 **Missing NFR** in requirements.md → Add performance criteria
- 🚫 **No stories** for `unit-api` → Create stories for API unit

### Recommended Actions

1 - **requirements**: Add missing NFR
2 - **stories**: Create stories for unit-api

**Type a number to fix the gap.**
```

### 5. Update Inception Log

When all checks pass, update `inception-log.md` (created during intent-create):

- Use template: `.specsmd/aidlc-turbo/templates/inception/inception-log-template.md`
- Update `status` to `complete`
- Update `completed` date
- Fill in Summary section with final counts
- Mark all items in "Ready for Construction" checklist as complete

Update these sections:

```markdown
---
intent: {NNN}-{intent-name}
created: {original-date}
completed: {today}
status: complete
---

## Summary

- **Functional Requirements**: {n}
- **Non-Functional Requirements**: {n}
- **Units**: {n}
- **Stories**: {n}
- **Bolts Planned**: {n}        # lean mode: 0 (bolts intentionally skipped)

## Ready for Construction

**Checklist**:
- [x] All requirements documented
- [x] System context defined
- [x] Units decomposed
- [x] Stories created for all units
- [x] Bolts planned                 # lean mode: omit this line (no bolts)
- [x] Human review complete

## Next Steps

1 - **construction**: Start building with first bolt

→ `/specsmd-aidlc-turbo-construction --unit="{first-unit}"`
```

**Lean mode** instead writes the terminal state and the converter handoff:

```markdown
## Summary

- **Functional Requirements**: {n}
- **Non-Functional Requirements**: {n}
- **Units**: {n}
- **Stories**: {n}
- **Bolts Planned**: 0 (lean mode — skipped by design)
- **Mode**: lean

## Ready for INFERNO conversion

**Checklist**:
- [x] All requirements documented
- [x] System context defined
- [x] Units decomposed (minimal grouping)
- [x] Stories created for all units
- [x] Human review complete

## Next Steps

1 - **convert**: Route stories into INFERNO work items

→ `/inception-to-inferno`
```

Set `status: complete` in `inception-log.md` in both modes — lean mode is a fully
completed inception, not a partial one.

### Step 6: Update Intent Status

Update `requirements.md` frontmatter:

```yaml
status: inception-complete
```

---

### Step 7: Ready for Construction

**Checkpoint 4**: Confirm ready to proceed:

```text
### Ready for Construction?

✅ Inception complete for {intent-name}

Summary:
- {n} functional requirements
- {m} non-functional requirements
- {x} units
- {y} stories
- {z} bolts planned

Ready to start construction?
1 - Yes, start with {first-unit}
2 - Yes, start with different unit
3 - Review something first
```

**Lean mode** presents the converter handoff instead — the terminal state is
"stories complete, no bolts":

```text
### Ready for INFERNO conversion?

✅ Inception complete (lean) for {intent-name}

Summary:
- {n} functional requirements
- {m} non-functional requirements
- {x} units (minimal grouping)
- {y} stories
- 0 bolts (lean mode — skipped by design)

Ready to convert into INFERNO work items?
1 - Yes, run /inception-to-inferno
2 - Review something first
```

**Wait for user response.**

---

## Output

```markdown
## Inception Review: {intent-name}

### Verification Results

- ✅ Artifacts complete
- ✅ Cross-references valid
- ✅ Stories have acceptance criteria
- ✅ Bolts planned                  # lean mode: "Bolts skipped (lean — valid terminal state)"

### Log Updated
- `{schema.intents}/{intent-name}/inception-log.md`

### Ready for Construction
✅ **INCEPTION COMPLETE**

Intent `{intent-name}` is ready for Construction Phase.

### Actions

1 - **construction**: Start building with first bolt

### Suggested Next Step
→ **construction** - Start with `/specsmd-aidlc-turbo-construction --unit="{first-unit}" --bolt-id="{first-bolt}"`

**Type a number or press Enter for suggested action.**
```

---

## Transition

After user confirms at Checkpoint 4:

- **Full mode** → **Construction Agent** - `/specsmd-aidlc-turbo-construction --unit="{unit}"`
- **Lean mode** → **inception → INFERNO converter** - `/inception-to-inferno`

If gaps found at Checkpoint 3:

- → Return to appropriate skill to fix

---

## Test Contract

```yaml
input: All inception artifacts (requirements, context, units, stories; bolts in full mode only), mode (full|lean)
output: inception-log.md updated (status: complete), intent status = inception-complete
terminal_states:
  full: bolts planned → Construction Agent
  lean: stories authored, no bolts (valid) → /inception-to-inferno converter
checkpoints: 2
  - Checkpoint 3: Artifacts reviewed and approved
  - Checkpoint 4: Ready for next phase confirmed (Construction in full mode; conversion in lean mode)
```
