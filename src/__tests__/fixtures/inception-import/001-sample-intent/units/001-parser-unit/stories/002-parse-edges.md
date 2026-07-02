---
id: 002-parse-edges
unit: 001-parser-unit
intent: 001-sample-intent
status: ready
priority: must
created: 2026-06-23T10:05:00Z
assigned_bolt: 001-parser-unit
implemented: false
---

# Story: 002-parse-edges

## User Story

**As a** converter
**I want** to read Requires edges from a story
**So that** the work item carries the right depends_on ordering

## Acceptance Criteria

- [ ] **Given** a story with a Requires edge, **When** extracted, **Then** the edge appears in depends_on
- [ ] **Given** a "None" Requires line, **When** extracted, **Then** no edge is produced

## Technical Notes

Edges normalize to in-intent story ids.

## Dependencies

### Requires
- 001-extract-stories (Extract stories)

### Enables
- 003-render-tree (Render the tree)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Prose Requires line | Dropped, not an edge |

## Out of Scope

- Cross-intent edges
