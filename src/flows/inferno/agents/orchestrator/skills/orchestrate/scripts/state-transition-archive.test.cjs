const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { check, archiveIntent, main } = require("./state-transition.cjs");
const { multisetDifference, sandbox, NOW } = require("./state-transition-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

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
  writeFile(brief, "# brief", "utf8");

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

test("archive-intent frees a block-sequence dependency", () => {
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
  assert.deepEqual(archiveIntent({ file, sweep: true, now: NOW }).freed, [
    { intent: "dependent", freed: ["done-one"] },
  ]);
  assert.match(fs.readFileSync(file, "utf8"), /depends_on_intents: \[\]/);
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
