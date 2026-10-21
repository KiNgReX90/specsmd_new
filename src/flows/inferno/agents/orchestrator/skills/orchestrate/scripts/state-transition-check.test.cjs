const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { completeItem, closeIntent, check } = require("./state-transition.cjs");
const { FIXTURE, sandbox, NOW } = require("./state-transition-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

// --- close-intent --------------------------------------------------------

test("close-intent refuses while any work item is open", () => {
  const { file } = sandbox();
  assert.throws(
    () => closeIntent({ file, intent: "tools-menu", now: NOW }),
    (error) => error.code === "ITEMS_OUTSTANDING" && /menu-shell \(pending\), menu-wiring \(pending\)/.test(error.message)
  );
  assert.match(fs.readFileSync(file, "utf8"), /status: in_progress/);
});

test("close-intent completes the intent and drops claimed_by once every item is done", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });
  completeItem({ file, intent: "tools-menu", item: "menu-wiring", proof: "abc1234", now: NOW });

  const result = closeIntent({ file, intent: "tools-menu", now: NOW });

  assert.equal(result.changed, true);
  assert.equal(result.items, 2);
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /- id: tools-menu\n {4}title: "Global tools menu"\n {4}status: completed\n {4}completed_at: 2026-07-14T12:00:00Z\n/);
  assert.doesNotMatch(out, /claimed_by:/);
  assert.match(out, /claimed_at: 2026-07-13T06:44:12Z/, "claimed_at is history and stays");
});

test("close-intent is idempotent", () => {
  const { file } = sandbox();
  const result = closeIntent({ file, intent: "already-shipped", now: NOW });
  assert.equal(result.changed, false);
});

// --- check ---------------------------------------------------------------

test("check flags an open intent whose items are all completed (the reported bug)", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });
  completeItem({ file, intent: "tools-menu", item: "menu-wiring", proof: "abc1234", now: NOW });

  const result = check({ file });

  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].intent, "tools-menu");
  assert.equal(result.drift[0].kind, "all-items-completed-intent-open");
});

test("check flags an intent closed over still-open items", () => {
  const { file } = sandbox(FIXTURE.replace("    status: in_progress\n", "    status: completed\n"));
  const result = check({ file });

  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].kind, "intent-completed-over-open-items");
  assert.match(result.drift[0].detail, /menu-shell \(pending\), menu-wiring \(pending\)/);
});

test("check is silent on a consistent ledger", () => {
  const { file } = sandbox();
  const result = check({ file, intent: "already-shipped" });
  assert.deepEqual(result.drift, []);
});

// A ledger holds more than pending/completed. Real projects carry deliberately parked
// states (superseded, on_hold, awaiting-manual). Reporting those as drift is a false
// positive, and finalize step 1b blocks on a non-zero check, so noise here stalls closes.

test("check does not flag a superseded intent whose items are all completed", () => {
  const { file } = sandbox(`intents:
  - id: dropped
    title: "Replaced by another approach"
    status: superseded
    work_items:
      - id: item-1
        title: "Item"
        status: completed
        depends_on: []
`);
  assert.deepEqual(check({ file }).drift, []);
});

test("check does not flag a parked intent that is deliberately open", () => {
  for (const parked of ["on_hold", "awaiting-manual"]) {
    const { file } = sandbox(`intents:
  - id: parked
    title: "Parked"
    status: ${parked}
    work_items:
      - id: item-1
        title: "Item"
        status: completed
        depends_on: []
`);
    assert.deepEqual(check({ file }).drift, [], `${parked} must not read as drift`);
  }
});

test("check does not flag a completed intent whose remaining item is parked", () => {
  const { file } = sandbox(`intents:
  - id: shipped
    title: "Shipped, one item parked for a human"
    status: completed
    work_items:
      - id: item-1
        title: "Built"
        status: completed
        depends_on: []
      - id: item-2
        title: "Manual ops step"
        status: on_hold
        depends_on: []
`);
  assert.deepEqual(check({ file }).drift, []);
});

test("check still flags a genuinely open intent whose items are all done", () => {
  // The BOX. line keeps this fixture down to its own subject: one item, exit named.
  const { file } = sandbox(`intents:
  - id: stuck
    title: "The reported bug"
    status: in_progress
    comment: |
      BOX. in flight: the file is owned by another run.
    work_items:
      - id: item-1
        title: "Item"
        status: completed
        depends_on: []
`);
  const result = check({ file });
  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].kind, "all-items-completed-intent-open");
});

// The test is the builder's context: a small change is built directly and anything larger is an
// intent. Every intent waiting to be claimed says on an INTENT. line what makes it more than one
// compact change, and a reason that only restates size or file count says nothing: two mechanisms
// and six files do not name the batch. The reason opens with the letter of the
// triage criterion that holds, and state-check-criterion.test.cjs holds that rule and its cutover.

const ONE_ITEM = `intents:
  - id: title-bar-ink
    title: "The mark takes the mood's ink"
    status: pending
    created: 2026-08-18
    depends_on_intents: []
    comment: |
      Captured 2026-08-18. One attribute in TitleBar.svelte plus a test.
    work_items:
      - id: ink-attr
        title: "Pass ink-bright instead of accent"
        kind: ui
        complexity: medium
        mode: autopilot
        status: pending
        depends_on: []
`;

// The same intent with its exit named. One added line is the whole difference.
const ONE_ITEM_BOXED = ONE_ITEM.replace(
  "      Captured 2026-08-18. One attribute in TitleBar.svelte plus a test.\n",
  "      Captured 2026-08-18. One attribute in TitleBar.svelte plus a test.\n" +
    "      BOX. (c) in flight: TitleBar.svelte cannot change before the-mood-ink/ink-attr lands\n"
);

test("check reports an intent waiting to be claimed with no reason line", () => {
  const { file } = sandbox(ONE_ITEM);
  const result = check({ file });

  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].intent, "title-bar-ink");
  assert.equal(result.drift[0].kind, "intent-without-exception-reason");
});

test("check accepts a one-item intent that names its exit from the fix-now box", () => {
  const { file } = sandbox(ONE_ITEM_BOXED);
  assert.deepEqual(check({ file }).drift, []);
});

test("check accepts an INTENT line, the name the BOX line took on 2026-09-06", () => {
  const { file } = sandbox(ONE_ITEM_BOXED.replace("BOX. (c) in flight: TitleBar.svelte cannot change before the-mood-ink/ink-attr lands", "INTENT. (e) the change must not reach main before the full gate proves it whole"));
  assert.deepEqual(check({ file }).drift, []);
});

// The line is the reason, so the keyword on its own is the same postponement the
// check exists to catch: an entry that says INTENT. and nothing else names no exit.
test("check reports an INTENT line with nothing after it", () => {
  const { file } = sandbox(
    ONE_ITEM_BOXED.replace("BOX. (c) in flight: TitleBar.svelte cannot change before the-mood-ink/ink-attr lands", "INTENT.")
  );
  const result = check({ file });

  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].kind, "intent-without-exception-reason");
  assert.match(result.drift[0].detail, /reason after it/);
});

test("check accepts an INTENT line that carries its reason", () => {
  const { file } = sandbox(
    ONE_ITEM_BOXED.replace(
      "BOX. (c) in flight: TitleBar.svelte cannot change before the-mood-ink/ink-attr lands",
      "INTENT. (e) one migration the gate must prove whole"
    )
  );
  assert.deepEqual(check({ file }).drift, []);
});

test("check accepts a BOX line written as a YAML comment", () => {
  const hashed = ONE_ITEM.replace(
    "      Captured 2026-08-18. One attribute in TitleBar.svelte plus a test.\n",
    "      Captured 2026-08-18. One attribute in TitleBar.svelte plus a test.\n" +
      "    # BOX. (c) in flight: TitleBar.svelte cannot change before the-mood-ink/ink-attr lands\n"
  );
  const { file } = sandbox(hashed);

  assert.deepEqual(check({ file }).drift, []);
});

test("check reports a quick-fixes.md beside the ledger as drift", () => {
  const { dir, file } = sandbox(ONE_ITEM_BOXED);
  writeFile(path.join(dir, "quick-fixes.md"), "# Quick fixes\n\n## parked\n\nstatus: open\n", "utf8");
  const result = check({ file });
  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].kind, "quick-fixes-file-present");
  assert.match(result.drift[0].detail, /builder directly/);
});

test("check scoped to one intent still reports the parking file", () => {
  const { dir, file } = sandbox(ONE_ITEM_BOXED);
  writeFile(path.join(dir, "quick-fixes.md"), "# Quick fixes\n", "utf8");
  assert.equal(check({ file, intent: "title-bar-ink" }).drift[0].kind, "quick-fixes-file-present");
});

test("check does not report the intent it is scoped away from", () => {
  const finished = ONE_ITEM.replace("        status: pending\n", "        status: completed\n");
  const { file } = sandbox(FIXTURE.replace("runs:\n", finished.replace("intents:\n", "") + "runs:\n"));
  assert.deepEqual(check({ file, intent: "already-shipped" }).drift, []);
  assert.equal(check({ file, intent: "title-bar-ink" }).drift[0].kind, "all-items-completed-intent-open");
});

test("check does not ask a parked one-item intent for a BOX line", () => {
  // Parked is a resting place, not work in flight, so there is no exit to name.
  const { file } = sandbox(ONE_ITEM.replace(/^    status: pending$/m, "    status: on_hold"));
  assert.deepEqual(check({ file }).drift, []);
});

test("check asks a two-item intent for its reason too, since size is no reason", () => {
  const { file } = sandbox(`intents:
  - id: two-items
    title: "Two items"
    status: pending
    work_items:
      - id: item-1
        title: "First"
        status: pending
        depends_on: []
      - id: item-2
        title: "Second"
        status: pending
        depends_on: []
`);
  assert.equal(check({ file }).drift[0].kind, "intent-without-exception-reason");
});

test("check rejects a reason that only restates size or file count", () => {
  for (const reason of ["INTENT. (d) six files and two mechanisms", "INTENT. (c) past the item ceiling, about thirty builder rounds"]) {
    const { file } = sandbox(ONE_ITEM_BOXED.replace("BOX. (c) in flight: TitleBar.svelte cannot change before the-mood-ink/ink-attr lands", reason));
    const drift = check({ file }).drift;
    assert.equal(drift.length, 1, `"${reason}" is size, not an exception`);
    assert.match(drift[0].detail, /only restates size/);
  }
});

test("check accepts a reason that names what one builder could not do", () => {
  const { file } = sandbox(ONE_ITEM_BOXED.replace(
    "BOX. (c) in flight: TitleBar.svelte cannot change before the-mood-ink/ink-attr lands",
    "INTENT. (e) a persisted format migration the cheap checks cannot prove piecemeal"
  ));
  assert.deepEqual(check({ file }).drift, []);
});

test("check leaves an intent a run already holds alone", () => {
  // The reason is a capture-time gate. An intent in flight is being built, and reporting it
  // now would only block its own close.
  const { file } = sandbox(ONE_ITEM.replace("    status: pending", "    status: in_progress"));
  assert.deepEqual(check({ file }).drift, []);
});

test("close-intent still refuses over a parked item", () => {
  const { file } = sandbox(`intents:
  - id: parked-item
    title: "Has a parked item"
    status: in_progress
    work_items:
      - id: item-1
        title: "Parked"
        status: on_hold
        depends_on: []
`);
  assert.throws(
    () => closeIntent({ file, intent: "parked-item", now: NOW }),
    (error) => error.code === "ITEMS_OUTSTANDING" && /item-1 \(on_hold\)/.test(error.message)
  );
});
