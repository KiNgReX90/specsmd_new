const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { CONFIG, INTENT_TREE, STATE, asPrinted, asPrintedByPath, git, intentReviewed, printed, repo, run, worktree, write } = require("./review-fixture.cjs");

// Every runner call a step prints for its caller carries the caller's tree, intent and host
// config. Run as printed on Codex, each call stays on Codex: an item review dispatches the
// Codex reviewer, an integrate runs the Codex checks, a gate waits on the Codex gate, and a
// teardown reads the Codex base. Each call runs from the project root, the way the
// orchestrator runs it.

const CODEX = ".specs-inferno/config.codex.yaml";
const codex = (finalize = "echo codex-gated") => ({
  [CODEX]: `verification:\n  integrate:\n    - echo codex-integrated\n  finalize:\n    - ${finalize}\ndelivery:\n  base_branch: main\n`,
});

/**
 * A ledger where another intent, listed first, holds an item named a-one too: a printed call
 * that drops --intent alpha reaches that intent instead.
 */
const SHARED = STATE.replace("intents:\n", `intents:
  - id: beta
    title: "Beta"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: a-one
        title: "Beta one"
        kind: behavior
        complexity: low
        status: pending
        depends_on: []
`);
const completed = (fields) => SHARED.replace(/(- id: alpha[\s\S]*?- id: a-one[\s\S]*?)status: pending/, `$1status: completed\n${fields}`);

/** The call dispatched the Codex reviewer for item a-one of alpha. */
function itemReviewer(result) {
  const shown = `${result.argv.join(" ")}\n${result.out}${result.err}`;
  assert.equal(result.code, 3, shown);
  assert.match(result.out, /^dispatch specsmd_inferno_reviewer item a-one$/m, shown);
  assert.match(result.out, /spec \.specs-inferno\/intents\/alpha\/work-items\/a-one\.md/, shown);
}

/** The integrate call stopped on the item's review, and the review call it printed dispatches the Codex reviewer. */
function integrateOwesReview(fixture, result) {
  assert.equal(result.code, 3, `${result.argv.join(" ")}\n${result.out}${result.err}`);
  itemReviewer(asPrinted(fixture, result.err, "review --item")[0]);
}

test("on Codex the item review's calls run as printed on Codex, from the integrate refusal to the landed item", () => {
  const fixture = repo({ state: SHARED, files: codex() });
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  git(fixture.root, ["commit", "-qam", "a-one landed"]);
  const refused = run(fixture, ["integrate", "--tree", fixture.root, "--item", "a-one", "--intent", "alpha", "--config", CODEX]);
  assert.equal(refused.code, 3, refused.out + refused.err);
  const [dispatched] = asPrinted(fixture, refused.err, "review --item");
  itemReviewer(dispatched);
  write(fixture.root, ".specs-inferno/intents/alpha/reviews/a-one.yaml", "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n");
  const [recorded] = asPrinted(fixture, dispatched.out, "review --item");
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
  const [landed] = asPrinted(fixture, recorded.out, "integrate --item");
  assert.equal(landed.code, 0, landed.out + landed.err);
  assert.match(landed.out, /codex-integrated/);
  assert.doesNotMatch(landed.out, /integrate ran/);
});

test("on Codex the frontier's HELD lines print the integrate and the review for the caller's host and intent", () => {
  const unproved = repo({ state: completed("        completed_at: 2099-01-01T00:00:00Z\n"), files: codex() });
  const held = run(unproved, ["frontier", "alpha", "--tree", unproved.root, "--config", CODEX]);
  assert.match(held.out, /HELD a-one: completed with no integration proof/);
  integrateOwesReview(unproved, asPrinted(unproved, held.out, "integrate --item")[0]);
  const unreviewed = repo({ state: completed("        completed_at: 2099-01-01T00:00:00Z\n        integrated_sha: abc1234\n"), files: codex() });
  const owing = run(unreviewed, ["frontier", "alpha", "--tree", unreviewed.root, "--config", CODEX]);
  assert.match(owing.out, /HELD a-one: completed with no clean item review/);
  itemReviewer(asPrinted(unreviewed, owing.out, "review --item")[0]);
  integrateOwesReview(unreviewed, asPrinted(unreviewed, owing.out, "integrate --item")[0]);
});

test("on Codex the gate's start, still-running and wait lines run as printed on the Codex gate", () => {
  const fixture = repo({ files: codex("sleep 2") });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  intentReviewed(tree);
  const none = run(fixture, ["gate", "--wait", "--tree", tree, "--config", CODEX]);
  assert.equal(none.code, 2, none.out + none.err);
  const [started] = asPrinted(fixture, none.err, "gate");
  assert.equal(started.code, 0, started.out + started.err);
  const early = run(fixture, ["gate", "--wait", "--minutes", "0.01", "--tree", tree, "--config", CODEX]);
  assert.equal(early.code, 4, early.out + early.err);
  const waited = asPrintedByPath(fixture, early.out);
  assert.ok(waited.argv[0].includes(" gate --wait "), waited.argv[0]);
  assert.equal(waited.code, 0, waited.out + waited.err);
  assert.match(waited.out, /sleep 2/);
  const again = asPrintedByPath(fixture, started.out);
  assert.equal(again.code, 0, again.out + again.err);
});

test("on Codex select's leftover line prints the teardown that reads the Codex base", () => {
  const state = STATE.replace("status: in_progress", "status: pending");
  const fixture = repo({ state, config: CONFIG.replace("base_branch: main", "base_branch: trunk"), files: codex() });
  const tree = worktree(fixture, INTENT_TREE);
  const selected = run(fixture, ["select", "--config", CODEX]);
  assert.match(selected.out, /leftover alpha/);
  const [torn] = asPrinted(fixture, selected.out, "teardown");
  assert.equal(torn.code, 0, torn.out + torn.err);
  assert.equal(fs.existsSync(tree), false);
});

/** A ledger writer call from the project root; its refusal prints on stderr. */
function writer(fixture, args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "state-transition.cjs"), ...args], { cwd: fixture.root, encoding: "utf8" });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

test("on Codex the ledger writer's refusals print the integrate and the review for the caller's host and intent", () => {
  const fixture = repo({ state: SHARED, files: codex() });
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  git(fixture.root, ["commit", "-qam", "a-one landed"]);
  const mark = ["complete-item", "--intent", "alpha", "--item", "a-one", "--file", ".specs-inferno/state.yaml", "--config", CODEX];
  const filled = (text) => text.replace(/<worktree>/g, fixture.root);
  const unproved = writer(fixture, mark);
  assert.equal(unproved.code, 2, unproved.out + unproved.err);
  integrateOwesReview(fixture, asPrinted(fixture, filled(unproved.err), "integrate --item")[0]);
  const named = writer(fixture, [...mark, "--tree", fixture.root]);
  integrateOwesReview(fixture, asPrinted(fixture, named.err, "integrate --item")[0]);
  const unreviewed = writer(fixture, [...mark, "--proof", git(fixture.root, ["rev-parse", "HEAD"])]);
  assert.equal(unreviewed.code, 2, unreviewed.out + unreviewed.err);
  itemReviewer(asPrinted(fixture, filled(unreviewed.err), "review --item")[0]);
});

// Integrate checks every review before it folds, and the ledger writer checks again when it
// completes the item. A base that reopened the item reaches the writer's own refusal after the
// fold, which prints the review call with integrate's tree, intent and host.
test("on Codex a review refusal the writer raises under integrate prints the review call for the caller's host", () => {
  const fixture = repo({ state: completed("        completed_at: 2010-01-01T00:00:00Z\n"), files: codex() });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  const ledger = path.join(fixture.root, ".specs-inferno/state.yaml");
  fs.writeFileSync(ledger, fs.readFileSync(ledger, "utf8").replace("status: completed\n        completed_at: 2010-01-01T00:00:00Z\n", "status: pending\n"));
  git(fixture.root, ["commit", "-qam", "a-one reopened"]);
  const refused = run(fixture, ["integrate", "--tree", tree, "--item", "a-one", "--intent", "alpha", "--config", CODEX]);
  assert.match(refused.err, /REVIEW_OWED/, refused.out + refused.err);
  itemReviewer(asPrinted(fixture, refused.err, "review --item")[0]);
});

test("the ledger writer's usage names the tree and host config its refusals print", () => {
  const usage = writer({ root: process.cwd() }, ["--help"]).out;
  assert.match(usage, /^ {2}--tree <dir> {4}\S/m);
  assert.match(usage, /^ {2}--config <file> \S/m);
});

// The writer's refusals point to writer and runner calls that carry the caller's intent and host
// config. An archive of an open intent points to close-intent, whose refusal over an open item
// points to the integrate that lands it, never to a complete-item that has no proof.
test("on Codex the archive and close refusals point through close-intent to the integrate, on the caller's host", () => {
  const fixture = repo({ state: SHARED, files: codex() });
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  git(fixture.root, ["commit", "-qam", "a-one landed"]);
  const archived = writer(fixture, ["archive-intent", "--intent", "alpha", "--config", CODEX]);
  assert.equal(archived.code, 2, archived.out + archived.err);
  const [close] = printed(archived.err, "close-intent", "state-transition");
  assert.ok(close, archived.err);
  const closing = writer(fixture, close);
  assert.equal(closing.code, 2, closing.out + closing.err);
  assert.doesNotMatch(closing.err, /complete-item/);
  const filled = closing.err.replace(/<worktree>/g, fixture.root).replace(/<id>/g, "a-one");
  integrateOwesReview(fixture, asPrinted(fixture, filled, "integrate --item")[0]);
});

// Every printed call is built by one named builder that owns its own flags, and carries the
// config and intent the process was called with, whatever a site passes. The builders are the
// module's whole surface: a builder with no row here, or a generic one exported again, goes red.
test("each call builder prints its exact line from the process's own flags, and run-call exports nothing else", () => {
  const calls = require("./run-call.cjs");
  const tail = ` --intent alpha --config ${CODEX}`;
  const rows = {
    gateStartCall: [[["/t", { config: "other" }], `run.cjs gate --detach --tree /t${tail}`]],
    gateWaitCall: [[["/t", { config: "other" }], `node ${calls.RUNNER_PATH} gate --wait --tree /t${tail}`]],
    itemReviewCall: [
      [["/t", {}, "a-one"], `run.cjs review --item a-one --tree /t${tail}`],
      [["/t", { intent: "beta" }, "a-one"], `run.cjs review --item a-one --tree /t --intent beta --config ${CODEX}`],
    ],
    integrateCall: [[["/t", {}, "a-one"], `run.cjs integrate --item a-one --tree /t${tail}`]],
    intentReviewCall: [[["/t", {}], `run.cjs review --tree /t${tail}`]],
    scanCall: [
      [["/t", {}], `run.cjs scan --tree /t${tail}`],
      [["/t", {}, true], `run.cjs scan --collect --tree /t${tail}`],
      [["/t", { plan: "alpha" }, true], `run.cjs scan --collect --only wiring --plan alpha --tree /t${tail}`],
    ],
    teardownCall: [[["/t", {}], `run.cjs teardown --tree /t${tail}`]],
    laneAcceptCall: [[["smoke", "/t"], `node ${calls.RUNNER_PATH} smoke --accept --harness-fix <sha> --tree /t${tail}`]],
    closeIntentCall: [[[{ config: "other" }], `state-transition.cjs close-intent --intent alpha --tree /t --config ${CODEX}`]],
    blockIntentCall: [[[{}], `state-transition.cjs block-intent --reason "<why it cannot be built yet>" --intent alpha --tree /t --config ${CODEX}`]],
    unclaimIntentCall: [[[{}], `state-transition.cjs unclaim-intent --intent alpha --tree /t --config ${CODEX}`]],
  };
  calls.caller({ config: CODEX, intent: "alpha", tree: "/t" });
  try {
    for (const [name, cases] of Object.entries(rows)) {
      for (const [args, line] of cases) assert.equal(calls[name](...args), line, name);
    }
  } finally {
    calls.caller({});
  }
  assert.deepEqual(Object.keys(calls).sort(), ["RUNNER", "RUNNER_PATH", "caller", ...Object.keys(rows)].sort());
});

test("on Codex the block, release and close lines the writer prints run as printed and carry the Codex config", () => {
  const fixture = repo({ files: codex() });
  const unreasoned = writer(fixture, ["block-intent", "--intent", "alpha", "--reason", " ", "--config", CODEX]);
  assert.equal(unreasoned.code, 2, unreasoned.out + unreasoned.err);
  const [block] = printed(unreasoned.err.replace('"<why it cannot be built yet>"', "vendor-fix"), "block-intent", "state-transition");
  assert.ok(block && block.join(" ").includes(`--config ${CODEX}`), unreasoned.err);
  const held = writer(fixture, block);
  assert.equal(held.code, 2, held.out + held.err);
  const [release] = printed(held.err, "unclaim-intent", "state-transition");
  assert.ok(release && release.join(" ").includes(`--config ${CODEX}`), held.err);
  assert.equal(writer(fixture, release).code, 0);
  const blocked = writer(fixture, block);
  assert.equal(blocked.code, 0, blocked.out + blocked.err);
  assert.match(fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8"), /blocked_reason: "?vendor-fix/);
  const done = repo({ state: STATE.replace(/status: pending/g, "status: completed\n        integrated_sha: abc1234\n        review: clean"), files: codex() });
  const drift = writer(done, ["check", "--intent", "alpha", "--config", CODEX]);
  assert.equal(drift.code, 1, drift.out + drift.err);
  const [close] = printed(drift.out + drift.err, "close-intent", "state-transition");
  assert.ok(close && close.join(" ").includes(`--config ${CODEX}`), drift.out + drift.err);
  // The planner runs the check ledger-wide, with no --intent, so its close names the intent it found.
  const wide = writer(done, ["check", "--config", CODEX]);
  assert.equal(wide.code, 1, wide.out + wide.err);
  const [wideClose] = printed(wide.out + wide.err, "close-intent", "state-transition");
  assert.deepEqual(wideClose, close, wide.out + wide.err);
  const closed = writer(done, wideClose);
  assert.equal(closed.code, 0, closed.out + closed.err);
});
