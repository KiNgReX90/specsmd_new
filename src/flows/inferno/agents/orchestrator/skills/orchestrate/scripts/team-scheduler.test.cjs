const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildBuilderPrompt,
  selectDispatchableItems,
  validateBuilderResult,
  validateWorkItem,
} = require("./team-scheduler.cjs");

function item(overrides = {}) {
  return {
    id: "item-1",
    title: "Implement the first item",
    kind: "behavior",
    depends_on: [],
    context: {
      required: [{ path: "src/app/foo.ts", reason: "Primary implementation target" }],
      patterns: [{ path: "src/app/bar.ts", reason: "Existing pattern to follow" }],
      tests: [{ path: "src/app/foo.test.ts", reason: "Relevant test coverage" }],
    },
    ownership: {
      editable: ["src/app/foo.ts", "src/app/foo.test.ts"],
    },
    ...overrides,
  };
}

test("validateWorkItem rejects missing required context and ownership", () => {
  const result = validateWorkItem({
    id: "bad-item",
    title: "Bad item",
    kind: "docs-only",
    context: { required: [] },
    ownership: { editable: [] },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "bad-item: context.required must contain at least one path",
    "bad-item: ownership.editable must contain at least one path",
  ]);
});

test("validateWorkItem requires patterns for behavior work and tests unless docs/config only", () => {
  const result = validateWorkItem(
    item({
      id: "behavior-item",
      context: {
        required: [{ path: "src/app/foo.ts", reason: "Primary implementation target" }],
        patterns: [],
        tests: [],
      },
    }),
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "behavior-item: context.patterns is required for behavior, architecture, ui, or api work",
    "behavior-item: context.tests is required unless the item is docs-only or config-only",
  ]);
});

test("selectDispatchableItems dispatches newly unblocked dependency frontier items", () => {
  const items = [
    item({ id: "item-1", depends_on: [], ownership: { editable: ["src/one.ts"] } }),
    item({ id: "item-2", depends_on: ["item-1"], ownership: { editable: ["src/two.ts"] } }),
    item({ id: "item-3", depends_on: ["item-1"], ownership: { editable: ["src/three.ts"] } }),
    item({ id: "item-4", depends_on: ["item-1"], ownership: { editable: ["src/four.ts"] } }),
  ];

  const ready = selectDispatchableItems(items, {
    completedIds: new Set(["item-1"]),
    inFlightItems: [],
  });

  assert.deepEqual(
    ready.map((entry) => entry.id),
    ["item-2", "item-3", "item-4"],
  );
});

test("selectDispatchableItems prevents ownership overlap across in-flight and selected items", () => {
  const items = [
    item({ id: "item-2", depends_on: [], ownership: { editable: ["src/shared.ts"] } }),
    item({ id: "item-3", depends_on: [], ownership: { editable: ["src/shared.ts"] } }),
    item({ id: "item-4", depends_on: [], ownership: { editable: ["src/other.ts"] } }),
  ];

  const ready = selectDispatchableItems(items, {
    completedIds: new Set(),
    inFlightItems: [{ id: "item-1", ownership: { editable: ["src/in-flight.ts"] } }],
  });

  assert.deepEqual(
    ready.map((entry) => entry.id),
    ["item-2", "item-4"],
  );
});

test("selectDispatchableItems skips items overlapping with existing in-flight ownership", () => {
  const items = [
    item({ id: "item-2", depends_on: [], ownership: { editable: ["src/shared.ts"] } }),
    item({ id: "item-3", depends_on: [], ownership: { editable: ["src/other.ts"] } }),
  ];

  const ready = selectDispatchableItems(items, {
    completedIds: new Set(),
    inFlightItems: [{ id: "item-1", ownership: { editable: ["src/shared.ts"] } }],
  });

  assert.deepEqual(
    ready.map((entry) => entry.id),
    ["item-3"],
  );
});

test("buildBuilderPrompt includes pointers and policy but not file bodies", () => {
  const prompt = buildBuilderPrompt(
    item({
      context: {
        required: [
          {
            path: "src/app/foo.ts",
            reason: "Primary implementation target",
            content: "SECRET_FILE_BODY",
          },
        ],
        patterns: [{ path: "src/app/bar.ts", reason: "Pattern file" }],
        tests: [{ path: "src/app/foo.test.ts", reason: "Test file" }],
      },
    }),
  );

  assert.match(prompt, /src\/app\/foo\.ts — Primary implementation target/);
  assert.match(prompt, /Start from the listed paths/);
  assert.doesNotMatch(prompt, /SECRET_FILE_BODY/);
});

test("validateBuilderResult accepts compact ready result and rejects noisy result", () => {
  const ready = validateBuilderResult({
    work_item: "item-3",
    status: "ready",
    changed_files: ["src/app/foo.ts"],
    tests: "npm test -- foo.test.ts pass",
    context_expansion: "read src/app/shared/foo-types.ts after import lookup",
    notes: "",
  });

  const noisy = validateBuilderResult({
    work_item: "item-3",
    status: "ready",
    changed_files: ["src/app/foo.ts"],
    tests: "",
    context_expansion: "",
    diff: "--- large diff ---",
  });

  assert.equal(ready.valid, true);
  assert.equal(noisy.valid, false);
  assert.deepEqual(noisy.errors, [
    "item-3: tests must summarize the verification command and result",
    "item-3: context_expansion must be a one-line summary; use \"none\" when no expansion happened",
    "item-3: compact result must not include diff, logs, reasoning, or file_bodies",
  ]);
});

test("validateBuilderResult accepts halted result with a note and rejects halted result without one", () => {
  const haltedWithNote = validateBuilderResult({
    work_item: "item-4",
    status: "halted",
    changed_files: [],
    tests: "not run; budget HALT before verification",
    context_expansion: "none",
    note: ".specs-inferno/halt-notes/item-4.md",
  });

  const haltedWithoutNote = validateBuilderResult({
    work_item: "item-4",
    status: "halted",
    changed_files: [],
    tests: "not run; budget HALT before verification",
    context_expansion: "none",
  });

  assert.equal(haltedWithNote.valid, true);
  assert.equal(haltedWithoutNote.valid, false);
  assert.deepEqual(haltedWithoutNote.errors, [
    "item-4: halted result must carry a note pointing to the halt-note file",
  ]);
});
