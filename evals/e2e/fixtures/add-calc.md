---
id: add-calc
title: Add calc() combining add and mul, with test
intent: toy-math
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: [add-add, add-mul]
created: 2026-06-12T00:00:00Z
---

# Work Item: Add calc() combining add and mul, with test

## Description

Create `lib/calc.js` exporting `calc(a, b)` = `add(a, b) * mul(a, b)`, requiring `./add` and `./mul`, plus `tests/calc.test.js` (node:test) verifying calc(2,3)=30.

## Acceptance Criteria

- [ ] `lib/calc.js` requires lib/add.js and lib/mul.js (no reimplementation)
- [ ] `node --test tests/calc.test.js` passes

## Execution Manifest

context:
  required:
    - path: lib/add.js
      reason: dependency output this item builds on
    - path: lib/mul.js
      reason: dependency output this item builds on
  patterns:
    - path: tests/add.test.js
      reason: test style to follow
  tests:
    - path: tests/
      reason: where the new test lives
ownership:
  editable:
    - lib/calc.js
    - tests/calc.test.js

## Technical Notes

(none)

## Dependencies

- add-add
- add-mul
