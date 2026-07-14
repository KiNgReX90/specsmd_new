const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { completeItem, closeIntent, check } = require("./state-transition.cjs");

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
  assert.match(result.drift[0].detail, /menu-shell, menu-wiring/);
});

test("check is silent on a consistent ledger", () => {
  const { file } = sandbox();
  const result = check({ file, intent: "already-shipped" });
  assert.deepEqual(result.drift, []);
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
