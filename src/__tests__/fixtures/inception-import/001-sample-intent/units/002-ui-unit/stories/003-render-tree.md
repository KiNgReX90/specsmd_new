---
id: 003-render-tree
unit: 002-ui-unit
intent: 001-sample-intent
status: ready
priority: should
created: 2026-06-23T10:10:00Z
assigned_bolt: 002-ui-unit
implemented: false
---

# Story: 003-render-tree

## User Story

**As a** developer
**I want** the converted plan rendered as a tree in the UI
**So that** I can see the work items before building

## Acceptance Criteria

- [ ] **Given** an extracted model, **When** the tree renders, **Then** each work item is a node
- [ ] **Given** a depends_on edge, **When** the tree renders, **Then** the edge is drawn between nodes

## Technical Notes

UI/render concern.

## Dependencies

### Requires
- 002-parse-edges (Parse dependency edges)
- 001-parser-unit/001-extract-stories (unit-qualified reference collapses to tail)
- User navigation

### Enables
- None

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| No work items | Empty tree placeholder |

## Out of Scope

- Editing nodes in place
