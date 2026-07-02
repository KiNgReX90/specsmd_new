# Skill: List Units (lean) / Bolts (full)

---

## Mode (lean default; full is a legacy escape hatch)

- **lean (default):** there are no bolts. List the intent's **units** with their story
  counts and completion, and ask which unit to build. Selecting a unit hands off to
  `bolt-start --unit="{unit}"`. Use the Lean Process below.
- **full (legacy):** list planned bolts from `.specs-aidlc-turbo/bolts/`. Use the Full
  Process below.

Resolve to lean unless `.specs-aidlc-turbo/bolts/` exists with planned bolts.

### Lean Process

1. Read `{intent}/units.md` for the unit list (and each `{intent}/units/{unit}/` for stories).
2. For each unit, count stories and how many are done (from the unit's construction-log, if any).
3. Present a numbered list of units with story counts + progress; ask which to build.
4. On selection, hand off to `bolt-start` with `--unit="{unit}"`.

---

## Checkpoints in This Skill

| Checkpoint | Purpose | Wait For |
|------------|---------|----------|
| Checkpoint 1 | Which unit (lean) / bolt (full) to work on? | User selection |

---

## Goal

Lean: display the intent's units with story counts and progress, and ask which to build.
Full: display all bolt instances with their status, optionally filtered by unit or intent.

The sections below are the **full (legacy)** bolt-listing process.

---

## Input

- **Required**: `.specsmd/aidlc-turbo/memory-bank.yaml` - artifact schema
- **Optional**: `--unit` - filter by unit name
- **Optional**: `--intent` - filter by intent name

---

## Process

### 1. Load Schema

Read `.specsmd/aidlc-turbo/memory-bank.yaml` to get the `bolts` path.
*(Default: `.specs-aidlc-turbo/bolts/`)*

### 2. Scan Bolt Files

For each bolt directory in `.specs-aidlc-turbo/bolts/`:

1. Read `bolt.md` frontmatter for metadata
2. Extract: id, unit, intent, bolt_type, status, current_stage, stories
3. The `bolt_type` field indicates which bolt type definition to use for stage information

### 3. Apply Filters

If `--unit` or `--intent` provided:

- Filter bolts to match the specified criteria
- Show "No bolts found" if none match

### 4. Calculate Progress

For each bolt, determine progress:

- **planned**: 0% - Not started
- **in-progress**: `stages_completed / total_stages`
- **complete**: 100%
- **blocked**: Show blocker reason

### 5. Display Results

Sort bolts by:

1. In-progress first (active work)
2. Planned (upcoming)
3. Blocked (needs attention)
4. Completed (historical)

---

## Output

```markdown
## Bolts Overview

### Active Bolts

- ⏳ **002-auth-service** (auth-service, {bolt-type}) - Stage: {current-stage}, 2/4 (50%) ← working

### Planned Bolts

- [ ] **003-auth-service** (auth-service) - Stories: 005-*, 006-* - Ready ✅
- [ ] **004-payment-api** (payment-api) - Stories: 001-*, 002-*, 003-* - Ready ✅

### Blocked Bolts

- 🚫 **005-api-gateway** - Waiting for auth (since 2024-12-04)

### Completed Bolts

- ✅ **001-auth-service** (auth-service) - Completed 2024-12-05 (4 hours)

### Summary
- **Total**: {n} bolts
- **In Progress**: {n}
- **Planned**: {n}
- **Completed**: {n}
- **Blocked**: {n}

### Actions

1 - **Continue active bolt**: Resume `002-auth-service`
2 - **Start planned bolt**: Begin `003-auth-service`
3 - **View bolt status**: Check detailed status
4 - **Plan new bolts**: Create additional bolts

**Type a number or bolt ID to continue.**
```

---

## Output (Filtered)

```markdown
## Bolts for Unit: {unit-name}

- ✅ **001-{unit-name}** ({bolt-type}) - Completed 100% - Stories: 001-*, 002-*
- ⏳ **002-{unit-name}** ({bolt-type}) - In progress 50% - Stories: 003-*, 004-* ← current
- [ ] **003-{unit-name}** ({bolt-type}) - Planned 0% - Stories: 005-*

### Quick Actions

1 - **Continue 002-{unit-name}**: Resume current work
2 - **View 001-{unit-name} status**: Review completed bolt

**Type a number to continue.**
```

---

## Bolt Selection

**Checkpoint 1**: Ask user which bolt to work on:

```text
### Available Bolts

1 - 001-{unit-name} (planned) - Stories: 001-*, 002-*
2 - 002-{unit-name} (planned) - Stories: 003-*, 004-*

Which bolt would you like to work on?
```

**Wait for user response.**

**CRITICAL**: Never auto-select a bolt. Always ask which bolt.

---

## Transition

After user selects bolt at Checkpoint 1:

- → **Bolt Start** - execute selected bolt

---

## Test Contract

```yaml
input: Unit name or intent filter
output: List of bolts with status
checkpoints: 1
  - Checkpoint 1: User selects which bolt to work on
```
