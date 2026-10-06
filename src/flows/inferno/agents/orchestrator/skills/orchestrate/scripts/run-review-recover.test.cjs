const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { killedMutate, repo, run, write } = require("./review-fixture.cjs");

// The item review is where the reviewer's mutants run, so a mutant a killed mutate left behind
// is put back before the review's dirty check. It never reads as the item's uncommitted work.

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";

test("an item review restores a killed mutate's mutant before its dirty check, then records", async () => {
  const fixture = repo();
  await killedMutate(fixture, fixture.root);
  write(fixture.root, REVIEW, "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n");
  const result = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^restored src\/a\.ts from an interrupted mutate$/m);
  assert.match(result.out, /review a-one clean, recorded/);
  assert.equal(fs.readFileSync(path.join(fixture.root, "src/a.ts"), "utf8"), "export const a = 1;\n");
});
