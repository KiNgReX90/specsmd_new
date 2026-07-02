---
id: 004-unresolvable-orphan
unit: 003-orphan-unit
intent: 001-sample-intent
status: draft
priority: could
created: 2026-06-23T10:15:00Z
assigned_bolt: null
implemented: false
---

# Story: 004-unresolvable-orphan

## User Story

**As a** developer
**I want** an aspirational capability with no concrete home yet
**So that** the converter has a story it cannot resolve to a real target

## Acceptance Criteria

- [ ] **Given** this story, **When** the converter tries to resolve an editable target, **Then** it finds none and flags the story

## Technical Notes

This unit deliberately maps to no resolvable ownership partition, so a
contract-valid work item cannot be built from it. The converter must flag and
skip it rather than emit an invalid item.

## Dependencies

### Requires
- None

### Enables
- None

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Unresolvable target | Flagged and skipped |

## Out of Scope

- Everything (no home yet)
