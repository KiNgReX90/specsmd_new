const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");

const { check, claimIntent, blockIntent, unblockIntent, main, loadState, locateIntents, findKeyLine, unquote } = require("./state-transition.cjs");
const { FIXTURE, multisetDifference, sandbox, NOW, withArchive, CLAIMABLE, RUN } = require("./state-transition-fixture.cjs");

// --- block-intent / unblock-intent ----------------------------------------
// The ledger could say an intent was waiting on another intent, and it could say nothing at
// all about one waiting on the world. So an intent that existed and could not be built yet
// sat on `pending` and was offered at every selection, and the only way to keep it out of a
// run was to leave it out of the ledger. `blocked` was already a parked status the drift
// check tolerated; nothing could write it.

/** A ledger entry someone parks: pending, no work items, its reason still to be written. */
const PARKED = `project:
  name: demo
intents:
  - id: waits-on-the-world
    title: "Waits on the world"
    status: pending
    created: 2026-09-10
    base_branch: main
    depends_on_intents: []
    # INTENT. the recapture spans two packages and cannot start before the app is finished.
`;

const REASON = "waits on the application being finished, the whole strip is re-recorded then";

/** Read one field back out of an intent entry, the way the ledger's own readers do. */
function fieldOf(file, intentId, key) {
  const lines = loadState(file);
  const intent = locateIntents(lines).find((entry) => entry.id === intentId);
  const idx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, key);
  return idx === -1 ? null : unquote(lines[idx].slice(intent.keyIndent + `${key}:`.length));
}

test("block-intent parks a pending intent with its reason and the moment", () => {
  const { file } = sandbox(CLAIMABLE);
  const result = blockIntent({ file, intent: "ready-one", reason: REASON, now: NOW });

  assert.equal(result.changed, true);
  assert.equal(result.previous, "pending");
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, REASON);
  const out = fs.readFileSync(file, "utf8");
  assert.match(
    out,
    new RegExp(
      `- id: ready-one\\n {4}title: "Ready one"\\n {4}status: blocked\\n` +
        ` {4}blocked_at: ${NOW}\\n {4}blocked_reason: "${REASON}"\\n`
    )
  );
});

test("block-intent refuses without a reason and writes nothing", () => {
  const { file } = sandbox(CLAIMABLE);
  const before = fs.readFileSync(file, "utf8");

  assert.throws(
    () => blockIntent({ file, intent: "ready-one", reason: "   ", now: NOW }),
    (error) => error.code === "NO_REASON" && /reason/.test(error.message)
  );
  assert.equal(fs.readFileSync(file, "utf8"), before, "a refusal writes nothing");
});

test("block-intent refuses an intent a run holds and names the way to release it", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.throws(
    () => blockIntent({ file, intent: "taken", reason: REASON, now: NOW }),
    (error) => error.code === "NOT_PENDING" && /unclaim-intent --intent taken/.test(error.message)
  );
});

test("block-intent refuses a completed intent", () => {
  const { file } = sandbox(FIXTURE);
  assert.throws(
    () => blockIntent({ file, intent: "already-shipped", reason: REASON, now: NOW }),
    (error) => error.code === "NOT_PENDING" && /completed/.test(error.message)
  );
});

test("block-intent is idempotent and keeps one pair of block fields", () => {
  const { file } = sandbox(CLAIMABLE);
  blockIntent({ file, intent: "ready-one", reason: REASON, now: NOW });
  const result = blockIntent({ file, intent: "ready-one", reason: "a second reason", now: NOW });

  assert.equal(result.changed, false);
  assert.match(result.note, /already blocked/);
  const out = fs.readFileSync(file, "utf8");
  assert.equal(out.match(/blocked_at:/g).length, 1);
  assert.equal(fieldOf(file, "ready-one", "blocked_reason"), REASON, "the first reason stands");
});

test("block-intent leaves the rest of the ledger untouched", () => {
  const { file } = sandbox(CLAIMABLE);
  const before = fs.readFileSync(file, "utf8").split("\n");
  blockIntent({ file, intent: "ready-one", reason: REASON, now: NOW });
  const after = fs.readFileSync(file, "utf8").split("\n");

  // One status line replaced, two block lines added. Anything more is a rewrite.
  assert.deepEqual(multisetDifference(before, after), ["    status: pending"]);
  assert.equal(multisetDifference(after, before).length, 3);
  assert.match(fs.readFileSync(file, "utf8"), /# Capture rationale that must survive the claim\./);
});

test("a blocked intent cannot be claimed", () => {
  const { file } = withArchive(sandbox(CLAIMABLE));
  blockIntent({ file, intent: "ready-one", reason: REASON, now: NOW });
  assert.throws(
    () => claimIntent({ file, intent: "ready-one", run: RUN, now: NOW }),
    (error) => error.code === "NOT_PENDING" && /blocked/.test(error.message)
  );
});

// The reason is free text a person types, so it reaches the ledger as one quoted scalar.
// An unquoted one would end at the first hash and take the rest of the sentence with it.
test("block-intent keeps a reason carrying a colon, a hash and a quote readable", () => {
  const { file } = sandbox(CLAIMABLE);
  const awkward = 'waits on the app: the "strip" is re-recorded # and recaptured';
  blockIntent({ file, intent: "ready-one", reason: awkward, now: NOW });

  assert.equal(fieldOf(file, "ready-one", "blocked_reason"), awkward);
  assert.equal(fieldOf(file, "ready-one", "status"), "blocked");
});

test("block-intent folds a reason written over several lines into one", () => {
  const { file } = sandbox(CLAIMABLE);
  blockIntent({ file, intent: "ready-one", reason: "waits on the app\nand on the recapture", now: NOW });

  assert.equal(fieldOf(file, "ready-one", "blocked_reason"), "waits on the app and on the recapture");
  assert.equal(fieldOf(file, "ready-one", "status"), "blocked");
});

test("unblock-intent returns the intent to pending and drops the block fields", () => {
  const { file } = sandbox(CLAIMABLE);
  blockIntent({ file, intent: "ready-one", reason: REASON, now: NOW });
  const result = unblockIntent({ file, intent: "ready-one" });

  assert.equal(result.changed, true);
  assert.equal(result.previous, "blocked");
  const out = fs.readFileSync(file, "utf8");
  assert.match(out, /- id: ready-one\n {4}title: "Ready one"\n {4}status: pending\n {4}created: 2026-07-10\n/);
  assert.doesNotMatch(out, /blocked_reason:/);
  assert.doesNotMatch(out, /blocked_at:/);
});

test("unblock-intent is idempotent on an intent that is already pending", () => {
  const { file } = sandbox(CLAIMABLE);
  const result = unblockIntent({ file, intent: "ready-one" });

  assert.equal(result.changed, false);
  assert.match(result.note, /not blocked/);
});

test("unblock-intent refuses an intent a run holds", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.throws(
    () => unblockIntent({ file, intent: "taken" }),
    (error) => error.code === "NOT_BLOCKED" && /in_progress/.test(error.message)
  );
});

// The whole point of the status: an intent parked with no work items is a resting place, and
// `check` has to stay quiet about it or finalize blocks on somebody else's parked intent.
test("check reports no drift over a blocked intent", () => {
  const { file } = sandbox(PARKED);
  blockIntent({ file, intent: "waits-on-the-world", reason: REASON, now: NOW });

  assert.deepEqual(check({ file }).drift, []);
  assert.equal(main(["check", "--file", file]), 0);
});

test("block-intent and unblock-intent are reachable through the CLI", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.equal(main(["block-intent", "--intent", "ready-one", "--reason", REASON, "--file", file, "--now", NOW]), 0);
  assert.equal(fieldOf(file, "ready-one", "status"), "blocked");
  assert.equal(main(["unblock-intent", "--intent", "ready-one", "--file", file]), 0);
  assert.equal(fieldOf(file, "ready-one", "status"), "pending");
});

test("block-intent through the CLI refuses without --intent or --reason", () => {
  const { file } = sandbox(CLAIMABLE);
  assert.throws(() => main(["block-intent", "--file", file]), (error) => error.code === "BAD_ARGS");
  assert.throws(
    () => main(["block-intent", "--intent", "ready-one", "--file", file]),
    (error) => error.code === "BAD_ARGS"
  );
  assert.throws(() => main(["unblock-intent", "--file", file]), (error) => error.code === "BAD_ARGS");
});
