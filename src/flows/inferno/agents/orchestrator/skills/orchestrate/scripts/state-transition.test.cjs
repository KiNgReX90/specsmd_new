const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { completeItem, closeIntent, check } = require("./state-transition.cjs");
const { FIXTURE, multisetDifference, sandbox, NOW } = require("./state-transition-fixture.cjs");

// --- complete-item -------------------------------------------------------

test("complete-item marks the target item completed with a timestamp", () => {
  const { file } = sandbox();
  const result = completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });

  assert.equal(result.changed, true);
  assert.equal(result.previous, "pending");
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /- id: menu-shell\n {8}title: "Menu shell"\n {8}kind: ui\n {8}complexity: low\n {8}mode: autopilot\n {8}status: completed\n {8}completed_at: 2026-07-14T12:00:00Z\n/);
});

test("complete-item leaves every other item untouched", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  // The sibling shares the old status value; only the addressed item may move.
  assert.match(out, /- id: menu-wiring\n {8}title: "Menu wiring"\n {8}status: pending\n/);
});

test("complete-item never touches the intent-level status", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  // Intent status sits at a shallower indent than item status; the writer must
  // discriminate by indent or it would close the intent by accident.
  assert.match(out, /- id: tools-menu\n {4}title: "Global tools menu"\n {4}status: in_progress\n/);
});

test("complete-item preserves load-bearing comment blocks", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.match(out, /# Captured 2026-07-13\. This comment block is load-bearing: it carries the\n {4}# capture rationale and must survive every transition\./);
});

test("complete-item writes a minimal diff", () => {
  const { file } = sandbox();
  const before = fs.readFileSync(file, "utf8").split("\n");
  completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });
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
    "        integrated_at: 2026-07-14T12:00:00Z",
    "        integrated_sha: abc1234",
    "        status: completed",
  ]);
});

test("complete-item is idempotent", () => {
  const { file } = sandbox();
  completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });
  const first = fs.readFileSync(file, "utf8");
  const result = completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: "2099-01-01T00:00:00Z" });

  assert.equal(result.changed, false);
  assert.equal(fs.readFileSync(file, "utf8"), first, "re-running must not rewrite the timestamp");
});

test("complete-item rejects an unknown item and names the known ones", () => {
  const { file } = sandbox();
  assert.throws(
    () => completeItem({ file, intent: "tools-menu", item: "nope", proof: "abc1234", now: NOW }),
    (error) => error.code === "ITEM_NOT_FOUND" && /menu-shell, menu-wiring/.test(error.message)
  );
});

test("complete-item rejects an unknown intent", () => {
  const { file } = sandbox();
  assert.throws(
    () => completeItem({ file, intent: "ghost", item: "menu-shell", proof: "abc1234", now: NOW }),
    (error) => error.code === "INTENT_NOT_FOUND"
  );
});

test("complete-item syncs the work-item markdown frontmatter", () => {
  const { dir, file } = sandbox();
  const mdDir = path.join(dir, "intents", "tools-menu", "work-items");
  fs.mkdirSync(mdDir, { recursive: true });
  const md = path.join(mdDir, "menu-shell.md");
  fs.writeFileSync(md, "---\nid: menu-shell\nstatus: pending\n---\n\n# Menu shell\n\nBody stays.\n", "utf8");

  completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });

  const out = fs.readFileSync(md, "utf8");
  assert.match(out, /^---\nid: menu-shell\nstatus: completed\ncompleted_at: 2026-07-14T12:00:00Z\n---\n/);
  assert.match(out, /Body stays\./);
});

test("complete-item succeeds when the work-item markdown is absent", () => {
  const { file } = sandbox();
  const result = completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });
  assert.equal(result.changed, true);
  assert.equal(result.markdown, null);
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
        review: clean
`;
  const { file } = sandbox(collide);
  completeItem({ file, intent: "shared-name", item: "shared-name", proof: "abc1234", now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.match(out, /- id: shared-name\n {4}title: "Intent"\n {4}status: in_progress\n/);
  assert.match(out, / {6}- id: shared-name\n {8}title: "Item with the same id as its intent"\n {8}status: completed\n/);
});

// --- complete-item needs the integration proof ---------------------------
// An item used to be marked completed before `integrate` ran, so a run that died
// between the mark and the checks left a ledger saying verified about a tree
// nothing had verified (five hours of red e2e on 2026-09-09). The proof is the
// sha integrate ran the checks on, and only integrate has it.

test("complete-item refuses an item with no integration proof and prints the fix", () => {
  const { file } = sandbox();
  assert.throws(
    () => completeItem({ file, intent: "tools-menu", item: "menu-shell", now: NOW }),
    (error) => error.code === "NO_PROOF" && /integrate --item menu-shell/.test(error.message)
  );
  assert.match(fs.readFileSync(file, "utf8"), /- id: menu-shell\n[\s\S]*?status: pending/);
});

test("complete-item records the sha and the moment the checks proved it", () => {
  const { file } = sandbox();
  const result = completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "abc1234", now: NOW });

  assert.equal(result.changed, true);
  assert.equal(result.integrated_sha, "abc1234");
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, / {8}integrated_sha: abc1234\n/);
  assert.match(out, / {8}integrated_at: 2026-07-14T12:00:00Z\n/);
});

test("complete-item backfills the proof onto an item an older run left unproven", () => {
  const { file } = sandbox(FIXTURE.replace(
    "      - id: menu-shell\n        title: \"Menu shell\"\n        kind: ui\n        complexity: low\n        mode: autopilot\n        status: pending\n",
    "      - id: menu-shell\n        title: \"Menu shell\"\n        kind: ui\n        complexity: low\n        mode: autopilot\n        status: completed\n"
  ));
  const result = completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "deadbee", now: NOW });

  assert.equal(result.changed, true);
  assert.match(fs.readFileSync(file, "utf8"), / {8}integrated_sha: deadbee\n/);
  assert.equal(
    completeItem({ file, intent: "tools-menu", item: "menu-shell", proof: "deadbee", now: NOW }).changed,
    false,
    "a proven item is already complete"
  );
});
