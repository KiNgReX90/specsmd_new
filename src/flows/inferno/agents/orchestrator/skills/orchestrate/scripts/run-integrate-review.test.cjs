const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, STATE, git, repo, reviewed, run, write } = require("./review-fixture.cjs");

// Every item is reviewed cold against its brief before it lands. integrate checks every id
// before the fold and writes nothing when one review is owed, so a batch never lands half.

const ledger = (fixture) => fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8");
const integrate = (fixture, ...args) => run(fixture, ["integrate", "--tree", fixture.root, ...args]);
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SIBLINGS = STATE.replace("        depends_on: [a-one]", "        depends_on: []");

test("integrate --item refuses an item with no clean review, exit 3, and names the command", () => {
  const fixture = repo();
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  git(fixture.root, ["commit", "-qam", "a-one landed"]);
  const tip = git(fixture.root, ["rev-parse", "HEAD"]);

  const result = integrate(fixture, "--item", "a-one");

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.err, /ERROR \[ITEM_REVIEW_OWED\]/);
  assert.match(result.err, new RegExp(`run\\.cjs review --item a-one --tree ${escaped(fixture.root)}`));
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), tip, "nothing folded, nothing committed");
  assert.doesNotMatch(ledger(fixture), /integrated_sha/);
});

test("integrate --items checks every id first and completes none while one review is owed", () => {
  const fixture = repo({ state: SIBLINGS });
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  write(fixture.root, "src/b.ts", "export const b = 5;\n");
  git(fixture.root, ["commit", "-qam", "the batch landed"]);
  reviewed(run, fixture, fixture.root, ["a-one"]);

  const result = integrate(fixture, "--items", "a-one,a-two");

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.err, /a-two/);
  assert.doesNotMatch(result.err, /review --item a-one/);
  assert.doesNotMatch(ledger(fixture), /integrated_sha/);
  assert.equal(git(fixture.root, ["status", "--porcelain"]), "");
});

test("integrate --items completes a batch whose every item is reviewed clean", () => {
  const fixture = repo({ state: SIBLINGS });
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  write(fixture.root, "src/b.ts", "export const b = 5;\n");
  git(fixture.root, ["commit", "-qam", "the batch landed"]);
  reviewed(run, fixture, fixture.root, ["a-one", "a-two"], ["src/a.ts", "src/b.ts"]);

  const result = integrate(fixture, "--items", "a-one,a-two");

  assert.equal(result.code, 0, result.out + result.err);
  assert.equal((ledger(fixture).match(/integrated_sha:/g) || []).length, 2);
});

test("integrate leaves a reviewed item open when a check goes red", () => {
  const fixture = repo({ config: CONFIG.replace("    - echo integrate ran", "    - echo the reason; exit 3") });
  reviewed(run, fixture, fixture.root, ["a-one"]);

  const result = integrate(fixture, "--item", "a-one");

  assert.equal(result.code, 2, result.out + result.err);
  assert.doesNotMatch(ledger(fixture), /integrated_sha/);
});

test("a change to a reviewed file voids the review, and a change to another item's file does not", () => {
  const fixture = repo();
  reviewed(run, fixture, fixture.root, ["a-one"]);
  write(fixture.root, "src/b.ts", "export const b = 9;\n");
  git(fixture.root, ["commit", "-qam", "another item landed beside it"]);
  assert.equal(integrate(fixture, "--item", "a-one").code, 0);

  const second = repo();
  reviewed(run, second, second.root, ["a-one"]);
  write(second.root, "src/a.ts", "export const a = 5;\n");
  git(second.root, ["commit", "-qam", "a-one changed after its review"]);
  const result = integrate(second, "--item", "a-one");
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.err, /changed since its review/);
});

test("a root file a review lists is not voided by a same-named file another item changes", () => {
  const fixture = repo({ files: { "index.ts": "export {};\n", "docs/index.ts": "export {};\n" } });
  reviewed(run, fixture, fixture.root, ["a-one"], ["index.ts"]);
  write(fixture.root, "docs/index.ts", "export const other = 1;\n");
  git(fixture.root, ["commit", "-qam", "another item changed its own index"]);

  const result = integrate(fixture, "--item", "a-one");

  assert.equal(result.code, 0, result.out + result.err);
});

// frontier tells the orchestrator to integrate an item completed with no proof. When that
// item predates the host's review cutover, the integrate it names must land it.
test("integrate proves an item completed before the host's review cutover without a review", () => {
  const interrupted = STATE.replace(
    /(- id: a-one[\s\S]*?)status: pending/,
    "$1status: completed\n        completed_at: 2026-09-10T09:00:00Z",
  );
  const fixture = repo({ state: interrupted });

  const result = integrate(fixture, "--item", "a-one");

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(ledger(fixture), /integrated_sha:/);
});
