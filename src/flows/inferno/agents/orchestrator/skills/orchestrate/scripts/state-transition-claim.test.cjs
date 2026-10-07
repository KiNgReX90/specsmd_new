const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");

const { claimIntent, unclaimIntent, main } = require("./state-transition.cjs");
const { FIXTURE, multisetDifference, sandbox, NOW, withArchive, CLAIMABLE, RUN } = require("./state-transition-fixture.cjs");

// --- claim-intent / unclaim-intent ---------------------------------------


test("claim-intent moves a pending intent to in_progress and records the run", () => {
  const { file } = withArchive(sandbox(CLAIMABLE));
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
  const { file } = withArchive(sandbox(CLAIMABLE));
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

test("claim-intent accepts a prerequisite the archive holds", () => {
  // An archived intent is gone from the live ledger by design, so the archive is where a
  // shipped prerequisite answers from.
  const { file } = withArchive(sandbox(CLAIMABLE));

  assert.equal(claimIntent({ file, intent: "ready-one", run: RUN, now: NOW }).changed, true);
});

// A misspelled prerequisite used to count as met, because an id nothing answered to was read
// as shipped. The claim then built on a foundation that had never been planned.
test("claim-intent refuses a prerequisite neither the ledger nor the archive knows", () => {
  const { file } = sandbox(CLAIMABLE);
  const before = fs.readFileSync(file, "utf8");

  assert.throws(
    () => claimIntent({ file, intent: "ready-one", run: RUN, now: NOW }),
    (error) => error.code === "DEPENDS_UNKNOWN" && /long-gone/.test(error.message),
  );
  assert.equal(fs.readFileSync(file, "utf8"), before, "a refusal writes nothing");
});

test("claim-intent re-uses an existing claimed_at line rather than adding a second", () => {
  const { file } = withArchive(sandbox(CLAIMABLE));
  claimIntent({ file, intent: "ready-one", run: RUN, now: NOW });
  unclaimIntent({ file, intent: "ready-one" });
  claimIntent({ file, intent: "ready-one", run: RUN, now: NOW });
  const out = fs.readFileSync(file, "utf8");

  assert.equal(out.match(/claimed_at: 2026-07-14T12:00:00Z/g).length, 1);
});

test("unclaim-intent returns the intent to pending and drops the claim", () => {
  const { file } = withArchive(sandbox(CLAIMABLE));
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
  const { file } = withArchive(sandbox(CLAIMABLE));
  assert.equal(main(["claim-intent", "--intent", "ready-one", "--run", RUN, "--file", file, "--now", NOW]), 0);
  assert.match(fs.readFileSync(file, "utf8"), /status: in_progress/);
  assert.equal(main(["unclaim-intent", "--intent", "ready-one", "--file", file]), 0);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /claimed_by: inferno-intent\/ready-one/);
});

test("claim-intent through the CLI refuses without --intent", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.throws(() => main(["claim-intent", "--file", file]), (error) => error.code === "BAD_ARGS");
});
