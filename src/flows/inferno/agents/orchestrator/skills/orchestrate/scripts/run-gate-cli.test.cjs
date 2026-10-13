const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");
const { CONFIG, closed, git, opened, repo, run, write } = require("./run-fixture.cjs");

// --- gate / green --------------------------------------------------------
// Running every missing proof, reusing it on an unchanged tree and the verdict either side of
// the gate are proved in run-gate.test.cjs, which also counts the command executions.
test("gate stops at the first failing command and points at its log", () => {
  const config = CONFIG.replace("    - echo always", "    - echo the reason; exit 3");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  const result = run(fixture, ["gate", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out, /FAIL/);
  assert.match(result.out, /the reason/);
  const log = /-> (\S+)/.exec(result.out)[1];
  assert.match(fs.readFileSync(log, "utf8"), /the reason/);
});

test("gate refuses a dirty tree", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 5;\n");
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 2);
});

test("a ledger-only commit keeps the tree green, a code commit does not", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  fs.appendFileSync(path.join(tree, ".specs-inferno/state.yaml"), "# bookkeeping\n");
  git(tree, ["commit", "-qam", "bookkeeping"]);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 0);

  write(tree, "src/a.ts", "export const a = 6;\n");
  git(tree, ["commit", "-qam", "code"]);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
});

// The marker is keyed on the code tree, and the gate used to key it on the tree as it stood when
// the last command finished. A commit landing mid-run then minted a green for code no command
// had read (2026-09-06: nine journeys ran, the committed pick wanted eleven).
test("a commit landing while the gate runs leaves no green marker", () => {
  const config = CONFIG.replace(
    "    - echo always",
    "    - printf 'export const a = 7;\\n' > src/a.ts; git commit -qam mid-gate",
  );
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  const result = run(fixture, ["gate", "--tree", tree]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out + result.err, /changed while the gate ran/);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
});

// --- gate --detach / --wait ------------------------------------------------
// The gate outruns the cap a host puts on one tool call, and a background tool call is
// orphaned when a headless run ends its turn. So the gate runs as its own process and the
// orchestrator blocks on it in slices: 0 green, 2 red, 4 still running.
const SLOW = CONFIG.replace("    - echo always", "    - sleep 2; echo slow");

test("gate --detach starts the gate in its own process and --wait reports it green", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const started = run(fixture, ["gate", "--tree", tree, "--detach"]);
  assert.equal(started.code, 0, started.out + started.err);
  assert.match(started.out, /gate started pid \d+/);
  assert.match(started.out, /gate --wait/);
  // An interactive orchestrator waits with one shell loop on the result file instead of
  // re-calling --wait every nine minutes at a full context round (26 rounds on 2026-09-08),
  // so --detach names that file beside the pid.
  const named = started.out.match(/^result (\S+gate-job\.result\.json)$/m);
  assert.ok(named, `no result line in: ${started.out}`);

  const waited = run(fixture, ["gate", "--tree", tree, "--wait", "--minutes", "0.5"]);
  assert.equal(waited.code, 0, waited.out + waited.err);
  assert.ok(fs.statSync(named[1]).size > 0, "the named result file holds the verdict");
  assert.match(waited.out, /PASS \d+s echo always/);
  assert.match(waited.out, /PASS \d+s echo scoped/);
  assert.match(waited.out, /green/);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 0);
});

// The gate's command waits for the test to let it go rather than for a clock: two seconds of
// sleep ran out before the early --wait on a loaded box, so the gate had finished and the
// "still running" answer never came. A hold also ends once its fixture dir is gone, so a hold that only starts after its test let go never outlives the test.
test("gate --wait exits 4 while the gate still runs, refuses a second start, and finishes on the next call", () => {
  const release = path.join(tempDir("inferno-hold-"), "release");
  const held = `until [ -f ${release} ] || [ ! -d ${path.dirname(release)} ]; do sleep 0.1; done; echo held`;
  const fixture = repo({ config: CONFIG.replace("    - echo always", `    - ${held}`) });
  const { tree } = opened(fixture);
  try {
    assert.equal(run(fixture, ["gate", "--tree", tree, "--detach"]).code, 0);
    const second = run(fixture, ["gate", "--tree", tree, "--detach"]);
    assert.equal(second.code, 2);
    assert.match(second.out + second.err, /already running/);
    const early = run(fixture, ["gate", "--tree", tree, "--wait", "--minutes", "0.01"]);
    assert.equal(early.code, 4, early.out + early.err);
    assert.match(early.out, /still running pid \d+/);
  } finally {
    writeFile(release, "");
  }
  const done = run(fixture, ["gate", "--tree", tree, "--wait", "--minutes", "0.5"]);
  assert.equal(done.code, 0, done.out + done.err);
  assert.match(done.out, /PASS \d+s until .*; echo held/);
});

test("gate --wait reports a red gate with the failing command and its log", () => {
  const config = CONFIG.replace("    - echo always", "    - echo the reason; exit 3");
  const fixture = repo({ config });
  const { tree } = opened(fixture);
  assert.equal(run(fixture, ["gate", "--tree", tree, "--detach"]).code, 0);
  const waited = run(fixture, ["gate", "--tree", tree, "--wait", "--minutes", "0.5"]);
  assert.equal(waited.code, 2, waited.out + waited.err);
  assert.match(waited.out, /FAIL \d+s echo the reason; exit 3 -> /);
  assert.match(waited.out, /the reason/);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
});

test("gate --wait without a started gate says how to start one", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const result = run(fixture, ["gate", "--tree", tree, "--wait"]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /gate --detach/);
});

test("gate --detach refuses a dirty tree before starting anything", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 8;\n");
  assert.equal(run(fixture, ["gate", "--tree", tree, "--detach"]).code, 2);
  assert.equal(run(fixture, ["gate", "--tree", tree, "--wait"]).code, 2);
});

// --- gate folds the base in ---------------------------------------------
/** Move the base branch on after the intent forked, the way another intent's ship does. */
function baseMoved(fixture, rel = "docs/moved.md", body = "main moved\n") {
  write(fixture.root, rel, body);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved while the intent was open"]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
}

test("gate folds the base branch in first, so the tree it proves is the tree that ships", () => {
  const fixture = repo();
  const { tree, branch } = closed(fixture);
  baseMoved(fixture);

  // The fold moved the tree the intent review read, so the gate owes that review first.
  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 3, gate.out + gate.err);
  assert.match(gate.out, new RegExp(`folded main into ${branch}`));
  assert.ok(fs.existsSync(path.join(tree, "docs/moved.md")));
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
  const ship = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(ship.code, 0, ship.out + ship.err);
});

test("gate says nothing about folding when the base has not moved", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  assert.doesNotMatch(gate.out, /folded/);
});

test("gate folds commits that reached origin but not the local base branch", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const other = path.join(fixture.dir, "other");
  git(fixture.dir, ["clone", "-q", "-b", "main", fixture.remote, other]);
  git(other, ["config", "user.email", "test@example.com"]);
  git(other, ["config", "user.name", "Test"]);
  write(other, "docs/remote.md", "pushed from elsewhere\n");
  git(other, ["add", "-A"]);
  git(other, ["commit", "-qm", "pushed from elsewhere"]);
  git(other, ["push", "-q", "origin", "main"]);

  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 3, "the fold moved the reviewed tree");
  assert.ok(fs.existsSync(path.join(tree, "docs/remote.md")));
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
  const ship = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(ship.code, 0, ship.out + ship.err);
});

test("gate stops on a fold conflict and names the files", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  baseMoved(fixture, "src/a.ts", "export const a = 9;\n");

  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 2, gate.out + gate.err);
  assert.match(gate.out + gate.err, /conflict folding main into/);
  assert.match(gate.out + gate.err, /src\/a\.ts/);
});

test("gate --detach folds the base in before the gate process starts", () => {
  const fixture = repo({ config: SLOW });
  const { tree, branch } = closed(fixture);
  baseMoved(fixture);

  const refused = run(fixture, ["gate", "--tree", tree, "--detach"]);
  assert.equal(refused.code, 3, refused.out + refused.err);
  assert.match(refused.out, new RegExp(`folded main into ${branch}`));
  assert.ok(fs.existsSync(path.join(tree, "docs/moved.md")));
  assert.equal(run(fixture, ["gate", "--tree", tree, "--detach"]).code, 0);
  assert.equal(run(fixture, ["gate", "--tree", tree, "--wait"]).code, 0);
  const ship = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(ship.code, 0, ship.out + ship.err);
});
