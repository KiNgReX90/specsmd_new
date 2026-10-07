const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, intentReviewed, killedMutate, repo, run, worktree, write } = require("./review-fixture.cjs");

// The gate never proves a tree the intent review has not read, and green never lets a merge
// through without a clean review for the tree and the evidence every external criterion
// names. Codex and a hand merge call green before they merge, so this holds for them too.

const GATED = CONFIG.replace("delivery:", "  finalize:\n    - echo gated\ndelivery:");

function opened() {
  const fixture = repo({ config: GATED });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  return { fixture, tree };
}

function baseMoved(fixture) {
  write(fixture.root, "docs/moved.md", "main moved\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved"]);
}

const gate = (fixture, tree, ...args) => run(fixture, ["gate", "--tree", tree, ...args]);
const green = (fixture, tree) => run(fixture, ["green", "--tree", tree, "--json"]);

test("gate folds the base in and then refuses a tree with no intent review", () => {
  const { fixture, tree } = opened();
  baseMoved(fixture);
  const result = gate(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /folded main into/);
  assert.match(result.out, /intent review owed/);
  assert.match(result.out, /run\.cjs review --tree/);
  assert.doesNotMatch(result.out, /echo gated/);
});

/** A clean review recorded the way the interim rule left one: tree and commit, and no scan. */
function reviewedUnscanned(tree) {
  const proofs = require("./run-proofs.cjs");
  const rel = ".specs-inferno/intents/alpha/review.yaml";
  write(tree, rel, `verdict: clean\ntree: ${proofs.scopeHash(tree)}\ncommit: ${git(tree, ["rev-parse", "HEAD"])}\n`);
  git(tree, ["add", "--", rel]);
  git(tree, ["commit", "-qm", "review with no scan", "--", rel]);
}

test("gate and green owe the scan for a clean review recorded without one", () => {
  const { fixture, tree } = opened();
  reviewedUnscanned(tree);
  const gated = gate(fixture, tree);
  assert.equal(gated.code, 3, gated.out + gated.err);
  assert.match(gated.out, /intent review owed: the scan is owed/);
  assert.match(gated.out, /run run\.cjs review --tree/);
  assert.doesNotMatch(gated.out, /echo gated/);
  const greened = run(fixture, ["green", "--tree", tree]);
  assert.equal(greened.code, 3, greened.out + greened.err);
  assert.match(greened.out, /the scan is owed/);
});

test("review refuses to record a review written while the scan is owed, and HEAD stays", () => {
  const { fixture, tree } = opened();
  const scan = ".specs-inferno/intents/alpha/scan.yaml";
  write(tree, scan, "lines: []\n");
  git(tree, ["add", "--", scan]);
  git(tree, ["commit", "-qm", "scan"]);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  git(tree, ["rm", "-q", "--", scan]);
  git(tree, ["commit", "-qm", "scan gone"]);
  const before = git(tree, ["rev-parse", "HEAD"]);
  write(tree, ".specs-inferno/intents/alpha/review.yaml", "verdict: clean\n");
  const result = run(fixture, ["review", "--tree", tree]);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /the scan of alpha is owed: run run\.cjs scan --tree/);
  assert.equal(git(tree, ["rev-parse", "HEAD"]), before);
});

test("gate --detach refuses before it starts a process", () => {
  const { fixture, tree } = opened();
  const result = gate(fixture, tree, "--detach");
  assert.equal(result.code, 3, result.out + result.err);
  assert.doesNotMatch(result.out, /gate started/);
});

test("a fold that moves a reviewed tree names the commit the base delta starts from", () => {
  const { fixture, tree } = opened();
  intentReviewed(tree);
  const before = git(tree, ["rev-parse", "--short", "HEAD"]);
  baseMoved(fixture);
  const result = gate(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, new RegExp(`from ${before}`));
});

test("a fix review blocks the gate, a clean one lets it run", () => {
  const { fixture, tree } = opened();
  const finding = "findings:\n  - criterion: c\n    file: src/a.ts\n    line: \"1\"\n    evidence: e\n    fix: f\n    owner: a-one\n";
  intentReviewed(tree, "alpha", `verdict: fix\n${finding}`);
  assert.equal(gate(fixture, tree).code, 3);
  intentReviewed(tree);
  const result = gate(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /PASS \d+s echo gated/);
});

test("green owes the review once the code moved after it", () => {
  const { fixture, tree } = opened();
  intentReviewed(tree);
  assert.equal(gate(fixture, tree).code, 0);
  assert.equal(green(fixture, tree).code, 0);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "moved"]);
  const result = green(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.ok(JSON.parse(result.out).owed.includes("review"));
});

test("green waits for the evidence of an external criterion", () => {
  const { fixture, tree } = opened();
  const evidence = ".specs-inferno/intents/alpha/evidence/by-hand.txt";
  intentReviewed(tree, "alpha", `verdict: clean\ncriteria:\n  - criterion: c\n    proof: external\n    where: by hand\n    evidence: ${evidence}\n`);
  assert.equal(gate(fixture, tree).code, 0);
  const waiting = green(fixture, tree);
  assert.equal(waiting.code, 3, waiting.out + waiting.err);
  assert.deepEqual(JSON.parse(waiting.out).owed, ["evidence"]);
  write(tree, evidence, "seen\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "evidence"]);
  const done = green(fixture, tree);
  assert.equal(done.code, 0, done.out + done.err);
  assert.ok(fs.existsSync(path.join(tree, evidence)));
});

test("green finds the evidence where the archive moved the intent", () => {
  const { fixture, tree } = opened();
  const evidence = ".specs-inferno/intents/alpha/evidence/by-hand.txt";
  write(tree, evidence, "seen\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "evidence"]);
  intentReviewed(tree, "alpha", `verdict: clean\ncriteria:\n  - criterion: c\n    proof: external\n    where: by hand\n    evidence: ${evidence}\n`);
  assert.equal(gate(fixture, tree).code, 0);
  fs.mkdirSync(path.join(tree, ".specs-inferno/archive/intents"), { recursive: true });
  git(tree, ["mv", ".specs-inferno/intents/alpha", ".specs-inferno/archive/intents/alpha"]);
  git(tree, ["commit", "-qm", "archive"]);
  const result = green(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
});

test("a mutant a killed mutate left behind is restored before the gate's dirty check", async () => {
  const { fixture, tree } = opened();
  intentReviewed(tree);
  await killedMutate(fixture, tree);
  const result = gate(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /restored src\/a\.ts from an interrupted mutate/);
  assert.equal(fs.readFileSync(path.join(tree, "src/a.ts"), "utf8"), "export const a = 3;\n");
});
