const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, killedMutate, repo, run, worktree, write } = require("./review-fixture.cjs");

// The intent review: one cold reviewer reads the whole intent against its brief before the
// gate. `run.cjs review` without --item dispatches it, then validates, records and commits
// the file it writes.

const REVIEW = ".specs-inferno/intents/alpha/review.yaml";

const SCAN = ".specs-inferno/intents/alpha/scan.yaml";

/** An intent with its work committed and, unless `scanned` is false, an empty scan collected. */
function started(options = {}) {
  const fixture = repo(options);
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  if (options.scanned !== false) write(tree, SCAN, "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the work"]);
  return { fixture, tree };
}

function opened(options) {
  const { fixture, tree } = started(options);
  // The dispatch the reviewer answers: a record binds the tree it was dispatched on.
  run(fixture, ["review", "--tree", tree]);
  return { fixture, tree };
}

const review = (fixture, tree, args = []) => run(fixture, ["review", "--tree", tree, ...args]);
const head = (tree) => git(tree, ["rev-parse", "HEAD"]);

test("review without --item dispatches the intent reviewer with the range, the brief and every item spec", () => {
  const { fixture, tree } = opened();
  const base = git(tree, ["merge-base", "HEAD", "main"]).slice(0, 7);
  const result = review(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /dispatch specsmd-inferno-reviewer model model-review intent alpha/);
  assert.match(result.out, new RegExp(`range ${base}[0-9a-f]*\\.\\.[0-9a-f]+`));
  assert.match(result.out, /brief \.specs-inferno\/intents\/alpha\/brief\.md/);
  assert.match(result.out, /a-one\.md/);
  assert.match(result.out, /a-two\.md/);
  assert.match(result.out, /write \.specs-inferno\/intents\/alpha\/review\.yaml/);
});

test("review folds the base in before it dispatches", () => {
  const { fixture, tree } = opened();
  write(fixture.root, "docs/moved.md", "main moved\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved"]);
  const result = review(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /folded main into/);
  assert.ok(fs.existsSync(path.join(tree, "docs/moved.md")));
});

test("a tree on no intent branch is refused until --intent names the intent", () => {
  const fixture = repo();
  const refused = review(fixture, fixture.root);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /--intent/);
  assert.equal(review(fixture, fixture.root, ["--intent", "alpha"]).code, 3);
});

test("the scan is owed first on any config, and the refusal prints the scan, the spawn and the collect", () => {
  const { fixture, tree } = opened({ scanned: false });
  const result = review(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, new RegExp(`run run\\.cjs scan --tree ${tree}, spawn the dispatch lines it prints in one message`));
  assert.match(result.out, new RegExp(`run run\\.cjs scan --collect --tree ${tree}, then run\\.cjs review --tree ${tree} again`));
  assert.doesNotMatch(result.out, /dispatch specsmd-inferno-reviewer/);
});

test("a clean review is validated, recorded with its tree and commit, and committed alone", () => {
  const { fixture, tree } = opened();
  const before = head(tree);
  write(tree, REVIEW, "verdict: clean\ncriteria:\n  - criterion: a is three\n    proof: test\n    where: node --test src/a.test.ts\n");
  const result = review(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /intent review clean/);
  assert.deepEqual(git(tree, ["show", "--name-only", "--format=", "HEAD"]).split("\n"), [REVIEW]);
  const recorded = fs.readFileSync(path.join(tree, REVIEW), "utf8");
  assert.match(recorded, /^tree: [0-9a-f]{64}$/m);
  assert.match(recorded, new RegExp(`^commit: ${before}$`, "m"));
  assert.equal(git(tree, ["status", "--porcelain"]), "");
  const again = review(fixture, tree);
  assert.equal(again.code, 0, again.out + again.err);
});

test("a fix review prints every finding under the item that owns it and exits 2", () => {
  const { fixture, tree } = opened();
  write(tree, REVIEW, [
    "verdict: fix",
    "findings:",
    "  - criterion: a is three",
    "    file: src/a.ts",
    "    line: \"1\"",
    "    evidence: read it",
    "    fix: make it four",
    "    owner: a-one",
    "  - criterion: docs say so",
    "    file: docs/b.md",
    "    line: \"1\"",
    "    evidence: read it",
    "    fix: say so",
    "    owner: a-two",
    "",
  ].join("\n"));
  const result = review(fixture, tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /FIX a-one: a is three src\/a\.ts:1/);
  assert.match(result.out, /FIX a-two: docs say so docs\/b\.md:1/);
  assert.match(result.out, /review --item/);
});

test("a change after the review makes it owed again, read from the recorded commit", () => {
  const { fixture, tree } = opened();
  write(tree, REVIEW, "verdict: clean\n");
  assert.equal(review(fixture, tree).code, 0);
  const recorded = head(tree);
  const read = /^commit: ([0-9a-f]+)$/m.exec(fs.readFileSync(path.join(tree, REVIEW), "utf8"))[1];
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a fix"]);
  const result = review(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.notEqual(read, recorded);
  assert.match(result.out, new RegExp(`range ${read.slice(0, 7)}[0-9a-f]*\\.\\.`));
});

test("review refuses to record over other uncommitted work", () => {
  const { fixture, tree } = opened();
  write(tree, REVIEW, "verdict: clean\n");
  write(tree, "src/b.ts", "export const b = 9;\n");
  const result = review(fixture, tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /src\/b\.ts/);
});

const FINDING = (owner) =>
  `findings:\n  - criterion: c\n    file: src/a.ts\n    line: "1"\n    evidence: e\n    fix: f\n    owner: ${owner}\n`;

for (const [name, body, reason] of [
  ["an unknown key", "verdict: clean\nnotes: later\n", /unknown key notes/],
  ["a finding whose owner is no item of the intent", `verdict: fix\n${FINDING("zeta")}`, /owner zeta/],
  ["an external criterion without evidence", "verdict: clean\ncriteria:\n  - criterion: c\n    proof: external\n    where: by hand\n", /evidence/],
  ["evidence on a criterion a test proves", "verdict: clean\ncriteria:\n  - criterion: c\n    proof: test\n    where: t\n    evidence: x\n", /for an external proof only/],
  ["verdict clean with a finding", `verdict: clean\n${FINDING("a-one")}`, /verdict clean with 1 finding/],
  ["verdict clean with a surviving mutant", "verdict: clean\nmutants:\n  - criterion: c\n    test: t\n    caught: no\n", /caught: no/],
  ["a tree the reviewer wrote itself", "verdict: clean\ntree: abc\n", /is written when the review is recorded/],
  ["an answer to a scan line that does not exist", "verdict: clean\nscanner:\n  - id: s9\n    answer: struck\n    reason: r\n", /s9/],
]) {
  test(`review refuses ${name} and records nothing`, () => {
    const { fixture, tree } = opened();
    const before = head(tree);
    write(tree, REVIEW, body);
    const result = review(fixture, tree);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, reason);
    assert.equal(head(tree), before);
  });
}

test("review refuses a scan line nobody answered", () => {
  const { fixture, tree } = opened();
  write(tree, SCAN, "lines:\n  - id: s1\n    scanner: wiring\n    file: src/a.ts\n    line: \"1\"\n    claim: c\n    proof: p\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  write(tree, REVIEW, "verdict: clean\n");
  const refused = review(fixture, tree);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /scan line s1/);
  write(tree, REVIEW, "verdict: clean\nscanner:\n  - id: s1\n    answer: struck\n    reason: the consumer exists\n");
  const answered = review(fixture, tree);
  assert.equal(answered.code, 0, answered.out + answered.err);
});

// --- mutant coverage ---------------------------------------------------------
// An item proven by a JavaScript or TypeScript test owes a caught mutant for every acceptance
// criterion, named by its text or its index. An item proven by Rust tests alone owes one, since
// each Rust mutant costs a compile. The mutant sits in the item review or here.

function itemSpec(id, criteria, tests) {
  return `---\nid: ${id}\nintent: alpha\nstatus: pending\n---\n\n# Work Item: ${id}\n\n## Acceptance Criteria\n\n` +
    `${criteria.map((text) => `- [ ] ${text}`).join("\n")}\n\n## Execution Manifest\n\ncontext:\n  tests:\n` +
    `${tests.map((p) => `    - path: ${p}\n      reason: proof`).join("\n")}\nownership:\n  editable:\n    - src/a.ts\n`;
}

const mutantList = (entries) =>
  `mutants:\n${entries.map(([criterion, test]) => `  - criterion: "${criterion}"\n    test: ${test}\n    caught: yes\n`).join("")}`;

function covered(specs, itemReviews = {}) {
  const { fixture, tree } = opened();
  for (const [id, [criteria, tests]] of Object.entries(specs)) {
    write(tree, `.specs-inferno/intents/alpha/work-items/${id}.md`, itemSpec(id, criteria, tests));
  }
  for (const [id, mutants] of Object.entries(itemReviews)) {
    write(tree, `.specs-inferno/intents/alpha/reviews/${id}.yaml`, `item: ${id}\nverdict: clean\nfiles: [src/a.ts]\n${mutantList(mutants)}`);
  }
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "specs and item reviews"]);
  return { fixture, tree };
}

test("a JS-proven item owes a caught mutant for every criterion, by text or by index", () => {
  const { fixture, tree } = covered(
    { "a-one": [["a is three", "a is exported"], ["src/a.test.ts"]], "a-two": [[], ["src/b.test.ts"]] },
    { "a-one": [["a is three", "node --test src/a.test.ts"]] },
  );
  write(tree, REVIEW, "verdict: clean\n");
  const refused = review(fixture, tree);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /a-one/);
  assert.match(refused.err, /a is exported/);
  assert.doesNotMatch(refused.err, /a is three/);
  assert.match(refused.err, /the runner's mutate step/);
  write(tree, REVIEW, `verdict: clean\n${mutantList([["a-one:2", "node --test src/a.test.ts"]])}`);
  const recorded = review(fixture, tree);
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
});

test("a Rust-only item owes one caught mutant, wherever it is recorded", () => {
  const { fixture, tree } = covered({ "a-one": [[], ["src/a.test.ts"]], "a-two": [["b runs", "b stops"], ["src/b.rs"]] });
  write(tree, REVIEW, "verdict: clean\n");
  const refused = review(fixture, tree);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /a-two has no caught mutant/);
  write(tree, REVIEW, `verdict: clean\n${mutantList([["b stops", "cargo test b_stops"]])}`);
  const recorded = review(fixture, tree);
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
});

test("a mixed item owes every criterion, and a cargo mutant that names one covers it", () => {
  const specs = { "a-one": [["a is three", "a crosses the bridge"], ["src/a.test.ts", "src/a.rs"]], "a-two": [[], []] };
  const { fixture, tree } = covered(specs, { "a-one": [["1", "node --test src/a.test.ts"]] });
  write(tree, REVIEW, "verdict: clean\n");
  const refused = review(fixture, tree);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /a crosses the bridge/);
  write(tree, REVIEW, `verdict: clean\n${mutantList([["a crosses the bridge", "cargo test bridge"]])}`);
  const recorded = review(fixture, tree);
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
});

test("a commit landing between the dispatch and the record is not recorded as reviewed", () => {
  const { fixture, tree } = opened();
  write(tree, "src/a.ts", "export const a = 5;\n");
  git(tree, ["commit", "-qam", "landed after the dispatch"]);
  const before = head(tree);
  write(tree, REVIEW, "verdict: clean\n");
  const result = review(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /moved since the dispatch/);
  assert.equal(head(tree), before);
});

test("a review written with no dispatch on record is refused and nothing is recorded", () => {
  const { fixture, tree } = started();
  const before = head(tree);
  write(tree, REVIEW, "verdict: clean\n");
  const result = review(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /has no dispatch on record/);
  assert.equal(head(tree), before);
});

test("the record restores a mutant a killed mutate left behind, then records over the whole file", async () => {
  const { fixture, tree } = opened();
  await killedMutate(fixture, tree);
  write(tree, REVIEW, "verdict: clean\n");
  const result = review(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /restored src\/a\.ts from an interrupted mutate/);
  assert.match(result.out, /intent review clean, recorded/);
  assert.equal(fs.readFileSync(path.join(tree, "src/a.ts"), "utf8"), "export const a = 3;\n");
  assert.equal(git(tree, ["status", "--porcelain"]), "");
});

test("in the intent review a number names a criterion only with its own item", () => {
  const { fixture, tree } = covered({ "a-one": [["a is three", "a is exported"], ["src/a.test.ts"]], "a-two": [["b"], []] });
  for (const names of [["a-two:1", "a-two:2"], ["1", "2"]]) {
    write(tree, REVIEW, `verdict: clean\n${mutantList(names.map((name) => [name, "node --test src/a.test.ts"]))}`);
    const refused = review(fixture, tree);
    assert.equal(refused.code, 2, refused.out + refused.err);
    assert.match(refused.err, /a-one owes a caught mutant for criteria 1 "a is three", 2 "a is exported"/);
  }
});

test("an item with no test path owes no mutant", () => {
  const { fixture, tree } = covered({ "a-one": [["a is three", "a is exported"], []], "a-two": [[], []] });
  write(tree, REVIEW, "verdict: clean\n");
  const result = review(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
});
