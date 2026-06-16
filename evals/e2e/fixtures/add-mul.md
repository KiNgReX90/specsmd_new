---
id: add-mul
title: Add mul() module with test
intent: toy-math
kind: behavior
complexity: low
mode: autopilot
status: pending
depends_on: []
created: 2026-06-12T00:00:00Z
---

# Work Item: Add mul() module with test

## Description

Create `lib/mul.js` exporting `mul(a, b)` (CommonJS: `module.exports = { mul }`) and `tests/mul.test.js` using `node:test` + `node:assert` verifying mul(2,3)=6 and mul(-1,1)=-1.

## Acceptance Criteria

- [ ] `lib/mul.js` exports mul(a, b) returning a * b
- [ ] `node --test tests/mul.test.js` passes

## Execution Manifest

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
    - lib/mul.js
    - tests/mul.test.js

## Technical Notes

(none)

## Dependencies

(none)
