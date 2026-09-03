const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  completeItem,
  closeIntent,
  check,
  archiveIntent,
  claimIntent,
  unclaimIntent,
  main,
} = require("./state-transition.cjs");

// Mirrors the real artifacts: load-bearing comment blocks, quoted and unquoted titles,
// and per-entry field order that differs between intents (status before/after kind).
const FIXTURE = `project:
  name: demo
  created: 2026-07-01T00:00:00Z
workspace:
  type: brownfield
intents:
  - id: tools-menu
    title: "Global tools menu"
    status: in_progress
    claimed_at: 2026-07-13T06:44:12Z
    claimed_by: inferno-intent/tools-menu-20260713-064412
    # Captured 2026-07-13. This comment block is load-bearing: it carries the
    # capture rationale and must survive every transition.
    created: 2026-07-13
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: menu-shell
        title: "Menu shell"
        kind: ui
        complexity: low
        mode: autopilot
        status: pending
        depends_on: []
      - id: menu-wiring
        title: "Menu wiring"
        status: pending
        complexity: medium
        mode: autopilot
        depends_on: [menu-shell]
  - id: already-shipped
    title: Prior intent
    status: completed
    completed_at: 2026-07-01T10:00:00Z
    work_items:
      - id: only-item
        title: Only item
        status: completed
        depends_on: []
runs:
  active: []
`;

/** Lines present in `a` that `b` does not account for, respecting duplicates. */
function multisetDifference(a, b) {
  const pool = [...b];
  const out = [];
  for (const line of a) {
    const at = pool.indexOf(line);
    if (at === -1) out.push(line);
    else pool.splice(at, 1);
  }
  return out;
}

function sandbox(content = FIXTURE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-state-"));
  const file = path.join(dir, "state.yaml");
  fs.writeFileSync(file, content, "utf8");
  return { dir, file };
}

const NOW = "2026-07-14T12:00:00Z";

// --- complete-item -------------------------------------------------------

test("complete-item marks the target item completed with a timestamp", () => {
  const { file } = sandbox();
  const result = completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });

  assert.equal(result.changed, true);
  assert.equal(result.previous, "pending");
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /- id: menu-shell\n {8}title: "Menu shell"\n {8}kind: ui\n {8}complexity: low\n {8}mode: autopilot\n {8}status: completed\n {8}completed_at: 2026-07-14T12:00:00Z\n/);
});

test("complete-item leaves every other item untouched", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  // The sibling shares the old status value; only the addressed item may move.
  assert.match(out, /- id: menu-wiring\n {8}title: "Menu wiring"\n {8}status: pending\n/);
});

test("complete-item never touches the intent-level status", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  // Intent status sits at a shallower indent than item status; the writer must
  // discriminate by indent or it would close the intent by accident.
  assert.match(out, /- id: tools-menu\n {4}title: "Global tools menu"\n {4}status: in_progress\n/);
});

test("complete-item preserves load-bearing comment blocks", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.match(out, /# Captured 2026-07-13\. This comment block is load-bearing: it carries the\n {4}# capture rationale and must survive every transition\./);
});

test("complete-item writes a minimal diff", () => {
  const { file } = sandbox();
  const before = fs.readFileSync(file, "utf8").split("\n");
  completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });
  const after = fs.readFileSync(file, "utf8").split("\n");

  // Exactly one line replaced and one added. A whole-file re-serialization would
  // rewrite everything, destroy comments, and turn each transition into a merge
  // conflict against concurrent sessions.
  // Compared as sets: an identical `status: completed` line elsewhere in the file makes
  // the pairing order arbitrary, but the multiset of changes is exact.
  const removed = multisetDifference(before, after).sort();
  const added = multisetDifference(after, before).sort();

  assert.deepEqual(removed, ["        status: pending"]);
  assert.deepEqual(added, [
    "        completed_at: 2026-07-14T12:00:00Z",
    "        status: completed",
  ]);
});

test("complete-item is idempotent", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });
  const first = fs.readFileSync(file, "utf8");
  const result = completeItem({ file, intent: "tools-menu", item: "menu-shell", now: "2099-01-01T00:00:00Z" });

  assert.equal(result.changed, false);
  assert.equal(fs.readFileSync(file, "utf8"), first, "re-running must not rewrite the timestamp");
});

test("complete-item rejects an unknown item and names the known ones", () => {
  const { file } = sandbox();
  assert.throws(
    () => completeItem({ file, intent: "tools-menu", item: "nope", now: NOW }),
    (error) => error.code === "ITEM_NOT_FOUND" && /menu-shell, menu-wiring/.test(error.message)
  );
});

test("complete-item rejects an unknown intent", () => {
  const { file } = sandbox();
  assert.throws(
    () => completeItem({ file, intent: "ghost", item: "menu-shell", now: NOW }),
    (error) => error.code === "INTENT_NOT_FOUND"
  );
});

test("complete-item syncs the work-item markdown frontmatter", () => {
  const { dir, file } = sandbox();
  const mdDir = path.join(dir, "intents", "tools-menu", "work-items");
  fs.mkdirSync(mdDir, { recursive: true });
  const md = path.join(mdDir, "menu-shell.md");
  fs.writeFileSync(md, "---\nid: menu-shell\nstatus: pending\n---\n\n# Menu shell\n\nBody stays.\n", "utf8");

  completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });

  const out = fs.readFileSync(md, "utf8");
  assert.match(out, /^---\nid: menu-shell\nstatus: completed\ncompleted_at: 2026-07-14T12:00:00Z\n---\n/);
  assert.match(out, /Body stays\./);
});

test("complete-item succeeds when the work-item markdown is absent", () => {
  const { file } = sandbox();
  const result = completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });
  assert.equal(result.changed, true);
  assert.equal(result.markdown, null);
});

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
  completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });
  completeItem({ file, intent: "tools-menu", item: "menu-wiring", now: NOW });

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
  completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW });
  completeItem({ file, intent: "tools-menu", item: "menu-wiring", now: NOW });

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
// positive, and finalize step 1b blocks on a non-zero check — so noise here stalls closes.

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
  const { file } = sandbox(`intents:
  - id: stuck
    title: "The reported bug"
    status: in_progress
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

// A one-item intent is the normal shape for a small change. Until 2026-08-30 the check
// pushed such an intent into quick-fixes.md, where nothing read it; now the parking file
// itself is the drift.

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

test("check accepts a pending intent with exactly one work item", () => {
  const { file } = sandbox(ONE_ITEM);
  assert.deepEqual(check({ file }).drift, []);
});

test("check reports a quick-fixes.md beside the ledger as drift", () => {
  const { dir, file } = sandbox(ONE_ITEM);
  fs.writeFileSync(path.join(dir, "quick-fixes.md"), "# Quick fixes\n\n## parked\n\nstatus: open\n", "utf8");
  const result = check({ file });
  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].kind, "quick-fixes-file-present");
  assert.match(result.drift[0].detail, /one-item intent/);
});

test("check scoped to one intent still reports the parking file", () => {
  const { dir, file } = sandbox(ONE_ITEM);
  fs.writeFileSync(path.join(dir, "quick-fixes.md"), "# Quick fixes\n", "utf8");
  assert.equal(check({ file, intent: "title-bar-ink" }).drift[0].kind, "quick-fixes-file-present");
});

test("check does not report the intent it is scoped away from", () => {
  const finished = ONE_ITEM.replace("        status: pending\n", "        status: completed\n");
  const { file } = sandbox(FIXTURE.replace("runs:\n", finished.replace("intents:\n", "") + "runs:\n"));
  assert.deepEqual(check({ file, intent: "already-shipped" }).drift, []);
  assert.equal(check({ file, intent: "title-bar-ink" }).drift[0].kind, "all-items-completed-intent-open");
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

// --- vocabulary / shape tolerance ---------------------------------------

test("treats the legacy `done` vocabulary as terminal", () => {
  const legacy = `intents:
  - id: foundation
    title: "Foundation"
    status: done
    work_items:
      - id: scaffold
        title: "Scaffold"
        kind: ui
        status: done
        depends_on: []
`;
  const { file } = sandbox(legacy);
  assert.deepEqual(check({ file }).drift, [], "done must not read as open");
  assert.equal(closeIntent({ file, intent: "foundation", now: NOW }).changed, false);
});

test("does not confuse an item id with an intent id", () => {
  const collide = `intents:
  - id: shared-name
    title: "Intent"
    status: in_progress
    work_items:
      - id: shared-name
        title: "Item with the same id as its intent"
        status: pending
        depends_on: []
`;
  const { file } = sandbox(collide);
  completeItem({ file, intent: "shared-name", item: "shared-name", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.match(out, /- id: shared-name\n {4}title: "Intent"\n {4}status: in_progress\n/);
  assert.match(out, / {6}- id: shared-name\n {8}title: "Item with the same id as its intent"\n {8}status: completed\n/);
});

// --- archive-intent ------------------------------------------------------

// A ledger shaped like the real ones: a completed intent carrying a comment block, a
// pending intent that depends on it, and a second completed intent for the sweep.
const ARCHIVABLE = `project:
  name: demo
intents:
  - id: foundation
    title: "Foundation"
    status: completed
    completed_at: 2026-07-01T10:00:00Z
    created: 2026-07-01
    base_branch: main
    depends_on_intents: []
    comment: |
      Capture rationale that must survive the move byte for byte.
    work_items:
      - id: fdn-scaffold
        title: "Scaffold"
        status: completed
        depends_on: []
  - id: second-shipped
    title: "Second shipped"
    status: completed
    completed_at: 2026-07-02T10:00:00Z
    depends_on_intents: [foundation]
    work_items:
      - id: snd-item
        title: "Item"
        status: completed
        depends_on: []
  - id: still-open
    title: "Still open"
    status: pending
    created: 2026-07-03
    depends_on_intents: [foundation, second-shipped]
    comment: |
      Source: the planner. This block is where the freed note lands.
    work_items:
      - id: open-item
        title: "Open item"
        status: pending
        depends_on: []
`;

test("archive-intent moves a completed intent out of the live ledger", () => {
  const { file } = sandbox(ARCHIVABLE);
  const result = archiveIntent({ file, intent: "foundation", now: NOW });

  assert.equal(result.changed, true);
  assert.deepEqual(result.archived, ["foundation"]);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /- id: foundation$/m);
});

test("archive-intent carries the block into the archive byte for byte", () => {
  const { file, dir } = sandbox(ARCHIVABLE);
  archiveIntent({ file, intent: "foundation", now: NOW });
  const archive = fs.readFileSync(path.join(dir, "archive", "state.yaml"), "utf8");

  assert.match(
    archive,
    / {2}- id: foundation\n {4}title: "Foundation"\n {4}status: completed\n {4}completed_at: 2026-07-01T10:00:00Z\n/
  );
  assert.match(archive, /Capture rationale that must survive the move byte for byte\./);
  assert.match(archive, / {6}- id: fdn-scaffold\n {8}title: "Scaffold"\n {8}status: completed\n/);
});

test("archive-intent creates the archive file with its header when there is none", () => {
  const { file, dir } = sandbox(ARCHIVABLE);
  archiveIntent({ file, intent: "foundation", now: NOW });
  const archive = fs.readFileSync(path.join(dir, "archive", "state.yaml"), "utf8");

  assert.match(archive, /^# Archived INFERNO intents/);
  assert.match(archive, /^intents:$/m);
});

test("archive-intent refuses an intent that is not completed", () => {
  const { file } = sandbox(ARCHIVABLE);
  assert.throws(() => archiveIntent({ file, intent: "still-open", now: NOW }), /NOT_COMPLETE|not completed/);
  assert.match(fs.readFileSync(file, "utf8"), /- id: still-open/);
});

test("archive-intent frees the archived id from a remaining intent's dependencies", () => {
  const { file } = sandbox(ARCHIVABLE);
  archiveIntent({ file, intent: "foundation", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.match(out, /- id: still-open\n[\s\S]*?depends_on_intents: \[second-shipped\]/);
});

test("archive-intent notes the freed prerequisite in the dependent's comment block", () => {
  const { file } = sandbox(ARCHIVABLE);
  archiveIntent({ file, intent: "foundation", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.match(out, /This block is where the freed note lands\.\n {6}Prerequisite foundation completed; record moved to archive\/state\.yaml on 2026-07-14\./);
});

test("archive-intent leaves an archived intent's own dependencies untouched", () => {
  const { file, dir } = sandbox(ARCHIVABLE);
  archiveIntent({ file, sweep: true, now: NOW });
  const archive = fs.readFileSync(path.join(dir, "archive", "state.yaml"), "utf8");

  // The archive is a historical record: second-shipped shipped depending on foundation
  // and that stays true forever, even though foundation is archived beside it.
  assert.match(archive, /- id: second-shipped\n[\s\S]*?depends_on_intents: \[foundation\]/);
});

test("archive-intent sweeps every completed intent in one pass", () => {
  const { file } = sandbox(ARCHIVABLE);
  const result = archiveIntent({ file, sweep: true, now: NOW });

  assert.deepEqual(result.archived, ["foundation", "second-shipped"]);
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /- id: still-open/);
  assert.doesNotMatch(out, /- id: foundation$/m);
  assert.doesNotMatch(out, /- id: second-shipped$/m);
  assert.match(out, /depends_on_intents: \[\]/);
});

test("archive-intent moves the intent directory under archive/intents", () => {
  const { file, dir } = sandbox(ARCHIVABLE);
  const brief = path.join(dir, "intents", "foundation", "brief.md");
  fs.mkdirSync(path.dirname(brief), { recursive: true });
  fs.writeFileSync(brief, "# brief", "utf8");

  archiveIntent({ file, intent: "foundation", now: NOW });

  assert.equal(fs.existsSync(path.join(dir, "archive", "intents", "foundation", "brief.md")), true);
  assert.equal(fs.existsSync(path.join(dir, "intents", "foundation")), false);
});

test("archive-intent is idempotent: a second run changes nothing", () => {
  const { file, dir } = sandbox(ARCHIVABLE);
  archiveIntent({ file, intent: "foundation", now: NOW });
  const afterFirst = fs.readFileSync(path.join(dir, "archive", "state.yaml"), "utf8");

  const again = archiveIntent({ file, intent: "foundation", now: NOW });

  assert.equal(again.changed, false);
  assert.equal(fs.readFileSync(path.join(dir, "archive", "state.yaml"), "utf8"), afterFirst);
});

test("archive-intent leaves a ledger with nothing completed alone", () => {
  const { file } = sandbox(ARCHIVABLE);
  archiveIntent({ file, sweep: true, now: NOW });
  const before = fs.readFileSync(file, "utf8");

  const result = archiveIntent({ file, sweep: true, now: NOW });

  assert.equal(result.changed, false);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("archive-intent loses no line of the ledger: every archived line lands in the archive", () => {
  const { file, dir } = sandbox(ARCHIVABLE);
  const before = fs.readFileSync(file, "utf8").split("\n");
  archiveIntent({ file, sweep: true, now: NOW });
  const after = fs.readFileSync(file, "utf8").split("\n");
  const archive = fs.readFileSync(path.join(dir, "archive", "state.yaml"), "utf8").split("\n");

  // Everything that left the live file must be findable in the archive, except the one
  // dependency line the freeing rewrote and the note it added.
  const gone = multisetDifference(before, after).filter(
    (line) => !/depends_on_intents: \[foundation, second-shipped\]/.test(line)
  );
  assert.deepEqual(multisetDifference(gone, archive), []);
});

test("archive-intent refuses a block-sequence dependency rather than skipping it", () => {
  const blockForm = `intents:
  - id: done-one
    title: "Done"
    status: completed
    work_items:
      - id: only
        title: "Only"
        status: completed
        depends_on: []
  - id: dependent
    title: "Dependent"
    status: pending
    depends_on_intents:
      - done-one
    work_items:
      - id: item
        title: "Item"
        status: pending
        depends_on: []
`;
  const { file } = sandbox(blockForm);
  assert.throws(() => archiveIntent({ file, sweep: true, now: NOW }), /DEPENDS_FORM|block sequence/);
});

test("archive-intent --sweep parses as a flag, not as a key expecting a value", () => {
  const { file } = sandbox(ARCHIVABLE);
  // The orchestrator reaches this through the CLI, never through require(), so the flag
  // has to survive parseArgs. It did not: --sweep read as a key and demanded a value.
  assert.equal(main(["archive-intent", "--sweep", "--file", file, "--now", NOW]), 0);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /- id: foundation$/m);
});

test("archive-intent through the CLI refuses with neither --intent nor --sweep", () => {
  const { file } = sandbox(ARCHIVABLE);
  assert.throws(() => main(["archive-intent", "--file", file]), (error) => error.code === "BAD_ARGS");
});

test("archive-intent notes the freed prerequisite in a hash-comment entry too", () => {
  // Half the real ledgers write their rationale as `#` lines rather than a `comment: |`
  // block. Freeing a dependency there left no trace of why the list shrank.
  const hashComments = `intents:
  - id: pipeline
    title: "Pipeline"
    status: completed
    work_items:
      - id: only
        title: "Only"
        status: completed
        depends_on: []
  - id: guard
    title: "Guard"
    status: pending
    depends_on_intents: [pipeline]
    # Source: the 2026-07-29 investigation.
    # Problem: the delete path never consults the protected list.
    work_items:
      - id: item
        title: "Item"
        status: pending
        depends_on: []
`;
  const { file } = sandbox(hashComments);
  archiveIntent({ file, sweep: true, now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.match(
    out,
    /# Problem: the delete path never consults the protected list\.\n {4}# Prerequisite pipeline completed; record moved to archive\/state\.yaml on 2026-07-14\.\n {4}work_items:/
  );
});

// --- claim-intent / unclaim-intent ---------------------------------------

// A ledger at the moment a run picks its intent: one claimable intent, one already
// claimed by another run, one waiting on a prerequisite that has not shipped.
const CLAIMABLE = `project:
  name: demo
intents:
  - id: ready-one
    title: "Ready one"
    status: pending
    created: 2026-07-10
    base_branch: main
    depends_on_intents: [long-gone]
    # Capture rationale that must survive the claim.
    work_items:
      - id: ready-item
        title: "Ready item"
        status: pending
        depends_on: []
  - id: taken
    title: "Taken"
    status: in_progress
    claimed_at: 2026-07-11T09:00:00Z
    claimed_by: inferno-intent/taken-20260711T090000Z
    depends_on_intents: []
    work_items:
      - id: taken-item
        title: "Taken item"
        status: pending
        depends_on: []
  - id: waiting
    title: "Waiting"
    status: pending
    depends_on_intents: [blocker]
    work_items:
      - id: waiting-item
        title: "Waiting item"
        status: pending
        depends_on: []
  - id: blocker
    title: "Blocker"
    status: pending
    depends_on_intents: []
    work_items:
      - id: blocker-item
        title: "Blocker item"
        status: pending
        depends_on: []
`;

const RUN = "inferno-intent/ready-one-20260714T120000Z";

test("claim-intent moves a pending intent to in_progress and records the run", () => {
  const { file } = sandbox(CLAIMABLE);
  const result = claimIntent({ file, intent: "ready-one", run: RUN, now: NOW });

  assert.equal(result.changed, true);
  assert.equal(result.previous, "pending");
  const out = fs.readFileSync(file, "utf8");
  assert.match(
    out,
    /- id: ready-one\n {4}title: "Ready one"\n {4}status: in_progress\n {4}claimed_at: 2026-07-14T12:00:00Z\n {4}claimed_by: inferno-intent\/ready-one-20260714T120000Z\n/
  );
});

test("claim-intent leaves the rest of the ledger untouched", () => {
  const { file } = sandbox(CLAIMABLE);
  const before = fs.readFileSync(file, "utf8").split("\n");
  claimIntent({ file, intent: "ready-one", run: RUN, now: NOW });
  const after = fs.readFileSync(file, "utf8").split("\n");

  // One status line replaced, two claim lines added. Anything more is a rewrite.
  assert.deepEqual(multisetDifference(before, after), ["    status: pending"]);
  assert.equal(multisetDifference(after, before).length, 3);
  assert.match(fs.readFileSync(file, "utf8"), /# Capture rationale that must survive the claim\./);
});

test("claim-intent refuses an intent another run already holds", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.throws(
    () => claimIntent({ file, intent: "taken", run: RUN, now: NOW }),
    (error) => error.code === "NOT_PENDING" && /in_progress/.test(error.message)
  );
});

test("claim-intent is idempotent for the run that already holds the intent", () => {
  const { file } = sandbox(CLAIMABLE);
  const result = claimIntent({
    file,
    intent: "taken",
    run: "inferno-intent/taken-20260711T090000Z",
    now: NOW,
  });

  assert.equal(result.changed, false);
  assert.match(result.note, /already claimed/);
});

test("claim-intent refuses while a prerequisite intent is still open", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.throws(
    () => claimIntent({ file, intent: "waiting", run: RUN, now: NOW }),
    (error) => error.code === "DEPENDS_UNMET" && /blocker/.test(error.message)
  );
});

test("claim-intent accepts a prerequisite that has already left for the archive", () => {
  // An archived intent is gone from the live ledger by design, so an id nothing in the
  // ledger answers to is shipped, not missing. Refusing it would make every intent whose
  // prerequisite archived permanently unclaimable.
  const { file } = sandbox(CLAIMABLE);
  const result = claimIntent({ file, intent: "ready-one", run: RUN, now: NOW });
  assert.equal(result.changed, true);
});

test("claim-intent re-uses an existing claimed_at line rather than adding a second", () => {
  const { file } = sandbox(CLAIMABLE);
  claimIntent({ file, intent: "ready-one", run: RUN, now: NOW });
  unclaimIntent({ file, intent: "ready-one" });
  claimIntent({ file, intent: "ready-one", run: RUN, now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.equal(out.match(/claimed_at: 2026-07-14T12:00:00Z/g).length, 1);
});

test("unclaim-intent returns the intent to pending and drops the claim", () => {
  const { file } = sandbox(CLAIMABLE);
  claimIntent({ file, intent: "ready-one", run: RUN, now: NOW });
  const result = unclaimIntent({ file, intent: "ready-one" });

  assert.equal(result.changed, true);
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /- id: ready-one\n {4}title: "Ready one"\n {4}status: pending\n {4}created: 2026-07-10\n/);
  assert.doesNotMatch(out, /claimed_by: inferno-intent\/ready-one/);
});

test("unclaim-intent is idempotent on an intent that is already pending", () => {
  const { file } = sandbox(CLAIMABLE);
  const result = unclaimIntent({ file, intent: "ready-one" });
  assert.equal(result.changed, false);
});

test("unclaim-intent refuses a completed intent", () => {
  const { file } = sandbox(FIXTURE);
  assert.throws(
    () => unclaimIntent({ file, intent: "already-shipped" }),
    (error) => error.code === "NOT_CLAIMED"
  );
});

test("claim-intent and unclaim-intent are reachable through the CLI", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.equal(main(["claim-intent", "--intent", "ready-one", "--run", RUN, "--file", file, "--now", NOW]), 0);
  assert.match(fs.readFileSync(file, "utf8"), /status: in_progress/);
  assert.equal(main(["unclaim-intent", "--intent", "ready-one", "--file", file]), 0);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /claimed_by: inferno-intent\/ready-one/);
});

test("claim-intent through the CLI refuses without --intent", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.throws(() => main(["claim-intent", "--file", file]), (error) => error.code === "BAD_ARGS");
});

// --- check after archive ---------------------------------------------------
test("check scoped to an archived intent answers archived with no drift", () => {
  const { file } = sandbox(ARCHIVABLE);
  archiveIntent({ file, intent: "foundation", now: NOW });
  const result = check({ file, intent: "foundation" });
  assert.deepEqual(result.drift, []);
  assert.equal(result.archived, "foundation");
  assert.equal(main(["check", "--intent", "foundation", "--file", file]), 0);
});

test("check scoped to an intent nobody knows still refuses", () => {
  const { file } = sandbox(ARCHIVABLE);
  assert.throws(() => check({ file, intent: "never-existed" }), (error) => error.code === "INTENT_NOT_FOUND");
});
