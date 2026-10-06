const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CONFIG, closed, git, opened, repo, run, write } = require("./run-fixture.cjs");

test("ship asks for the gate when the folded tree has no green marker", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 3);
  assert.match(result.out, /run gate first/);
});

test("ship merges, pushes, and tears the worktree and branch down", () => {
  const fixture = repo();
  const { tree, branch } = closed(fixture);
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /shipped/);
  assert.match(git(fixture.root, ["log", "-1", "--pretty=%s"]), new RegExp(`Merge branch '${branch}'`));
  assert.equal(git(fixture.root, ["rev-parse", "main"]), git(fixture.root, ["rev-parse", "origin/main"]));
  assert.equal(fs.existsSync(tree), false);
  assert.equal(git(fixture.root, ["branch", "--list", branch]).trim(), "");
});

test("ship merges with a dirty primary checkout and keeps its edits", () => {
  const fixture = repo();
  const { tree, branch } = closed(fixture);
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
  // Another session's edit to a file the intent never touched, plus an untracked note.
  write(fixture.root, "docs/b.md", "docs, edited by another session\n");
  write(fixture.root, "HANDOFF.md", "another session's note\n");
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(git(fixture.root, ["log", "-1", "--pretty=%s"]), new RegExp(`Merge branch '${branch}'`));
  assert.equal(fs.readFileSync(path.join(fixture.root, "docs/b.md"), "utf8"), "docs, edited by another session\n");
  assert.equal(fs.existsSync(path.join(fixture.root, "HANDOFF.md")), true);
});

test("ship refuses an intent that is not closed", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /completed/);
});

test("ship refuses when the primary checkout is not on the base branch", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  git(fixture.root, ["checkout", "-q", "-b", "sidetrack"]);
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /main/);
});

// --- teardown ------------------------------------------------------------
/** Merge alpha by hand from the primary checkout, the way a host without the gate does. */
function mergedByHand(fixture) {
  const { tree, branch } = closed(fixture);
  git(fixture.root, ["merge", "-q", "--no-ff", "-m", `Merge branch '${branch}'`, branch]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  return { tree, branch };
}

test("teardown removes a merged worktree and its branch", () => {
  const fixture = repo();
  const { tree, branch } = mergedByHand(fixture);
  const result = run(fixture, ["teardown", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(fs.existsSync(tree), false);
  assert.equal(git(fixture.root, ["branch", "--list", branch]).trim(), "");
});

test("teardown resolves its base from the selected host config", () => {
  const fixture = repo();
  const { tree } = mergedByHand(fixture);
  write(fixture.root, ".specs-inferno/config.yaml", CONFIG.replace("base_branch: main", "base_branch: missing-base"));
  write(fixture.root, ".specs-inferno/config.codex.yaml", "delivery:\n  base_branch: main\n");
  const result = run(fixture, ["teardown", "--tree", tree, "--config", ".specs-inferno/config.codex.yaml"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(fs.existsSync(tree), false);
});

test("teardown refuses a worktree whose commits the base does not hold", () => {
  const fixture = repo();
  const { tree, branch } = mergedByHand(fixture);
  write(tree, "src/a.ts", "export const a = 9;\n");
  git(tree, ["commit", "-qam", "work after the merge"]);
  const result = run(fixture, ["teardown", "--tree", tree]);

  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /Ship it first/);
  assert.equal(fs.existsSync(tree), true);
  assert.notEqual(git(fixture.root, ["branch", "--list", branch]).trim(), "");
});

test("teardown refuses the worktree of an intent still in progress", () => {
  const fixture = repo();
  const { tree } = opened(fixture);
  const result = run(fixture, ["teardown", "--tree", tree]);

  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /in progress/);
  assert.equal(fs.existsSync(tree), true);
});

test("select names a merged worktree its intent no longer needs as a leftover", () => {
  const fixture = repo();
  const { tree, branch } = mergedByHand(fixture);
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.deepEqual(result.leftovers, [{ id: "alpha", path: tree, branch }]);
  assert.match(run(fixture, ["select"]).out, new RegExp(`leftover alpha  ${tree}`));
});

test("select never calls a claimed intent's worktree a leftover", () => {
  const fixture = repo();
  opened(fixture);
  const result = JSON.parse(run(fixture, ["select", "--json"]).out);
  assert.deepEqual(result.leftovers, []);
});


test("ship checks the proofs from its selected host config", () => {
  const fixture = repo();
  const { tree } = closed(fixture);
  const config = ".specs-inferno/config.codex.yaml";
  write(tree, config, CONFIG.replace("echo always", "echo codex always"));
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "Codex gate configuration"]);
  const gated = run(fixture, ["gate", "--tree", tree, "--config", config]);
  assert.equal(gated.code, 0, gated.out + gated.err);
  assert.equal(run(fixture, ["green", "--tree", tree]).code, 3);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree, "--config", config]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.match(shipped.out, /shipped/);
  assert.equal(fs.existsSync(tree), false);
});
