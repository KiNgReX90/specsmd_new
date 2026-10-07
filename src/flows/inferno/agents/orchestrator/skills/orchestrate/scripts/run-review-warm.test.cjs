const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");

// A delta review goes to the reviewer that read the item or the intent before, resumed warm.
// Recording a review names that reviewer's agent id, and the record keeps it beside the tree
// and the commit. An item's first review and the intent's first review stay cold, and the
// intent review never resumes an item's reviewer.

const ITEM_REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const INTENT_REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const CODEX = ".specs-inferno/config.codex.yaml";

const itemReview = (fixture, args = []) => run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, ...args]);
const shown = (result) => result.out + result.err;

const FIX = `item: a-one
verdict: fix
files: [src/a.ts]
findings:
  - criterion: AC1 the value reads two
    file: src/a.ts
    line: 1
    evidence: read src/a.ts, it exports 1
    fix: export 2
    severity: major
`;
const CLEAN = "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n";

/** An item whose first review said fix, recorded by `reviewer`, and whose fix is committed. */
function fixedAfter(fixture, reviewer) {
  assert.equal(itemReview(fixture).code, 3);
  write(fixture.root, ITEM_REVIEW, FIX);
  const recorded = itemReview(fixture, ["--reviewer", reviewer]);
  assert.equal(recorded.code, 2, shown(recorded));
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  git(fixture.root, ["commit", "-qam", "the fix"]);
}

test("an item's first review dispatches a cold reviewer, and its record call names the reviewer's id", () => {
  const fixture = repo();
  const first = itemReview(fixture);
  assert.equal(first.code, 3, shown(first));
  assert.match(first.out, /^dispatch specsmd-inferno-reviewer model model-review item a-one$/m);
  assert.doesNotMatch(first.out, /^resume /m);
  assert.match(first.out, new RegExp(`^then run\\.cjs review --item a-one --reviewer <agent-id> --tree ${fixture.root} records it$`, "m"));
});

test("the record writes the reviewer's id beside the tree and the commit", () => {
  const fixture = repo();
  write(fixture.root, ITEM_REVIEW, CLEAN);
  const recorded = itemReview(fixture, ["--reviewer", "rev-a1"]);
  assert.equal(recorded.code, 0, shown(recorded));
  const file = fs.readFileSync(path.join(fixture.root, ITEM_REVIEW), "utf8");
  assert.match(file, /^tree: [0-9a-f]{64}\ncommit: [0-9a-f]{40}\nreviewer: rev-a1\n$/m);
});

test("a record without the reviewer's id, or with the placeholder, refuses and prints the call with the flag", () => {
  const fixture = repo();
  write(fixture.root, ITEM_REVIEW, FIX);
  for (const args of [[], ["--reviewer", "<agent-id>"]]) {
    const refused = itemReview(fixture, args);
    assert.equal(refused.code, 2, shown(refused));
    assert.match(refused.err, /ERROR \[NO_REVIEWER\]/);
    assert.match(refused.err, new RegExp(`run\\.cjs review --item a-one --reviewer <agent-id> --tree ${fixture.root}`));
    assert.match(refused.err, /the id the host returned when it spawned the reviewer/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8"), /review:/);
  assert.notEqual(git(fixture.root, ["status", "--porcelain", "--", ITEM_REVIEW]), "");
});

test("a review owed after a recorded one resumes that reviewer with the same lines and a fresh fallback", () => {
  const fixture = repo();
  fixedAfter(fixture, "rev-a1");
  const delta = itemReview(fixture);
  assert.equal(delta.code, 3, shown(delta));
  assert.doesNotMatch(delta.out, /^dispatch /m);
  const lines = delta.out.split("\n");
  const at = lines.indexOf("resume rev-a1 item a-one with SendMessage");
  assert.ok(at > 0, delta.out);
  assert.match(lines[at + 1], /^ {2}range [0-9a-f]{7,}\.\.[0-9a-f]{7,} paths src\/a\.ts/);
  assert.equal(lines[at + 2], "  spec .specs-inferno/intents/alpha/work-items/a-one.md");
  assert.equal(lines[at + 3], "  brief .specs-inferno/intents/alpha/brief.md");
  assert.equal(lines[at + 4], `  write ${ITEM_REVIEW}`);
  assert.equal(lines[at + 5], "  if it does not answer, dispatch a fresh specsmd-inferno-reviewer model model-review with these lines");
  assert.match(lines[at + 6], /^then run\.cjs review --item a-one --reviewer <agent-id> --tree /);
  write(fixture.root, ITEM_REVIEW, CLEAN);
  const clean = itemReview(fixture, ["--reviewer", "rev-a1"]);
  assert.equal(clean.code, 0, shown(clean));
});

test("on Codex the resume is a followup_task to the recorded reviewer", () => {
  const fixture = repo({ files: { [CODEX]: "verification:\n  integrate:\n    - echo codex\ndelivery:\n  base_branch: main\n" } });
  fixedAfter(fixture, "rev-x9");
  const delta = itemReview(fixture, ["--config", CODEX]);
  assert.equal(delta.code, 3, shown(delta));
  assert.match(delta.out, /^resume rev-x9 item a-one with followup_task$/m);
  assert.match(delta.out, /^ {2}if it does not answer, dispatch a fresh specsmd_inferno_reviewer with these lines$/m);
});

/** An intent worktree with its work committed, an empty scan collected and an item review by `itemReviewer`. */
function intentStarted(itemReviewer) {
  const fixture = repo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the work"]);
  write(tree, ITEM_REVIEW, CLEAN);
  const item = run(fixture, ["review", "--item", "a-one", "--tree", tree, "--reviewer", itemReviewer]);
  assert.equal(item.code, 0, shown(item));
  return { fixture, tree };
}

test("the intent's first review dispatches cold and never resumes an item's reviewer", () => {
  const { fixture, tree } = intentStarted("rev-item");
  const first = run(fixture, ["review", "--tree", tree]);
  assert.equal(first.code, 3, shown(first));
  assert.match(first.out, /^dispatch specsmd-inferno-reviewer model model-review intent alpha$/m);
  assert.doesNotMatch(first.out, /resume|rev-item/);
  assert.match(first.out, new RegExp(`^then run\\.cjs review --reviewer <agent-id> --tree ${tree} records it$`, "m"));
});

test("the intent review's record refuses without the reviewer's id, writes it, and the next intent review resumes it", () => {
  const { fixture, tree } = intentStarted("rev-item");
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, "verdict: clean\n");
  const refused = run(fixture, ["review", "--tree", tree]);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`ERROR \\[NO_REVIEWER\\].*run\\.cjs review --reviewer <agent-id> --tree ${tree}`));
  const recorded = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-int"]);
  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(fs.readFileSync(path.join(tree, INTENT_REVIEW), "utf8"), /^commit: [0-9a-f]{40}\nreviewer: rev-int$/m);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a later fix"]);
  const delta = run(fixture, ["review", "--tree", tree]);
  assert.equal(delta.code, 3, shown(delta));
  assert.match(delta.out, /^resume rev-int intent alpha with SendMessage$/m);
  assert.doesNotMatch(delta.out, /^dispatch |rev-item/m);
  assert.match(delta.out, /^ {2}if it does not answer, dispatch a fresh specsmd-inferno-reviewer model model-review with these lines$/m);
});
