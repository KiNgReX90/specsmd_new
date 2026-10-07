const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { CONFIG, INTENT_TREE, STATE, asPrinted, git, intentReviewed, repo, run, worktree, write } = require("./review-fixture.cjs");

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
  const [waited] = asPrinted(fixture, early.out, "gate");
  assert.equal(waited.code, 0, waited.out + waited.err);
  assert.match(waited.out, /sleep 2/);
  const [again] = asPrinted(fixture, started.out, "gate");
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
