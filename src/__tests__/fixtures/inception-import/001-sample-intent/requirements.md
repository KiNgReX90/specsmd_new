---
id: 001-sample-intent
intent: 001-sample-intent
status: complete
created: 2026-06-23T10:00:00Z
---

# Requirements: Sample Intent

## Goal

Provide a small but realistic completed memory-bank intent so the
inception-import extraction core can be exercised end to end.

## Users

- Developers running the inception→INFERNO bridge.

## Problem

Without a fixture, the converter's mechanical extraction is untested and can
silently drift.

## Success Criteria

- Stories extract with ids, units, acceptance criteria, and dependency edges.
- Units map to ownership partitions; bolts never leak into the output.
