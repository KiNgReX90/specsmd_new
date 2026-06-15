---
id: add-add
title: Add add() module with test
intent: toy-math
kind: behavior
complexity: low
mode: autopilot
status: pending
depends_on: []
created: 2026-06-12T00:00:00Z
---

# Work Item: Add add() module with test

## Description

Create `lib/add.js` exporting `add(a, b)` (CommonJS: `module.exports = { add }`) and `tests/add.test.js` using `node:test` + `node:assert` verifying add(2,3)=5 and add(-1,1)=0.

## Acceptance Criteria

- [ ] `lib/add.js` exports add(a, b) returning a + b
- [ ] `node --test tests/add.test.js` passes

## Team Execution Manifest

context:
  required:
    - path: package.json
      reason: test script and module conventions
  patterns: []
  tests:
    - path: tests/
      reason: where the new test lives
ownership:
  editable:
    - lib/add.js
    - tests/add.test.js

## Technical Notes

(none)

## Dependencies

(none)
