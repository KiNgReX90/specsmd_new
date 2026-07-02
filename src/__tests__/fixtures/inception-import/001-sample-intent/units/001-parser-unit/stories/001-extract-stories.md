---
id: 001-extract-stories
unit: 001-parser-unit
intent: 001-sample-intent
status: ready
priority: must
created: 2026-06-23T10:00:00Z
assigned_bolt: 001-parser-unit
implemented: false
---

# Story: 001-extract-stories

## User Story

**As a** converter
**I want** to read every story file under a unit
**So that** each story becomes a candidate work item

## Acceptance Criteria

- [ ] **Given** a unit with story files, **When** I extract the intent, **Then** every story is present in the model
- [ ] **Given** a story file, **When** it is extracted, **Then** its id, unit, and acceptance criteria are captured

## Technical Notes

Pure read + parse; no state mutation.

## Dependencies

### Requires
- None (first story)

### Enables
- 002-parse-edges (Parse dependency edges)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Empty stories dir | Unit contributes no stories |

## Out of Scope

- Rendering work items
