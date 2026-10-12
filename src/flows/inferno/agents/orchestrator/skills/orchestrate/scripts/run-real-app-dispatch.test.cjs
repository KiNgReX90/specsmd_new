const assert = require("node:assert/strict");
const test = require("node:test");

const { CONFIG, INTENT_TREE, asPrinted, git, repo, run, worktree, write } = require("./review-fixture.cjs");
const frontier = require("./run-frontier-fixture.cjs");

// A host that names its real-app helpers gets the check in every reviewer dispatch and the
// rule in every builder dispatch. A host that names none sees neither line.

const REAL_APP = `${CONFIG}real_app:\n  paths: ["integration/lib/**", "integration/TEST-CASES.md"]\n`;

const realAppLines = (text) => text.split("\n").filter((line) => /\breal-app\b/.test(line));

test("the item reviewer dispatch carries the check over the item's range and its own paths", () => {
  const fixture = repo({ config: REAL_APP });
  const result = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(result.code, 3, result.out + result.err);
  const [line] = realAppLines(result.out);
  assert.match(line, /^ {2}real-app run\.cjs real-app --range [0-9a-f]{7,}\.\.[0-9a-f]{7,} --item a-one --tree /);
  const [ran] = asPrinted(fixture, result.out, "real-app --item");
  assert.equal(ran.code, 0, ran.out + ran.err);
  assert.equal(ran.out, "");
});

test("--item limits the removals to the paths the item owns", () => {
  const fixture = repo({
    config: REAL_APP,
    files: { "src/b.ts": "export const b = '<i data-testid=\"b-panel\"></i>';\n", "integration/lib/b.mjs": "find('testid=b-panel');\n" },
  });
  const base = git(fixture.root, ["rev-parse", "HEAD"]);
  write(fixture.root, "src/b.ts", "export const b = '<i></i>';\n");
  git(fixture.root, ["commit", "-qam", "b loses its id"]);
  const check = (item) => run(fixture, ["real-app", "--range", `${base}..HEAD`, "--item", item, "--tree", fixture.root]);
  assert.equal(check("a-one").out, "");
  const owner = check("a-two");
  assert.equal(owner.code, 2, owner.out + owner.err);
  assert.deepEqual(owner.out.trim().split("\n"), [
    "stale integration/lib/b.mjs:1 names testid b-panel that the diff removed",
    "drives integration/lib/b.mjs via testid b-panel",
  ]);
});

test("the intent reviewer dispatch carries the check over the intent's range", () => {
  const fixture = repo({ config: REAL_APP });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the work"]);
  const result = run(fixture, ["review", "--tree", tree]);
  assert.equal(result.code, 3, result.out + result.err);
  const base = git(tree, ["merge-base", "HEAD", "main"]).slice(0, 7);
  assert.deepEqual(realAppLines(result.out).map((line) => line.replace(/ --tree .*/, "")), [
    `  real-app run.cjs real-app --range ${base}..${git(tree, ["rev-parse", "--short", "HEAD"])}`,
  ]);
});

test("a host without real_app.paths gets no real-app line in either dispatch", () => {
  const fixture = repo();
  assert.deepEqual(realAppLines(run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]).out), []);
  const tree = frontier.fixture();
  assert.deepEqual(realAppLines(frontier.run(tree, ["probes", "a-panel"]).out), []);
});

test("probes hands each builder the rule for the configured helpers, written and never run", () => {
  const tree = frontier.fixture();
  write(tree.root, ".specs-inferno/config.yaml", 'real_app:\n  paths: ["integration/lib/**", "integration/*.test.mjs"]\n');
  const result = frontier.run(tree, ["probes", "a-panel"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(realAppLines(result.out), [
    "real-app a-panel: when this piece changes a screen, update the helpers and case texts under " +
      "integration/lib/**, integration/*.test.mjs that drive the real app; write them and never run them",
  ]);
  assert.deepEqual(JSON.parse(frontier.run(tree, ["probes", "a-panel", "--json"]).out).real_app, [
    "integration/lib/**", "integration/*.test.mjs",
  ]);
});
