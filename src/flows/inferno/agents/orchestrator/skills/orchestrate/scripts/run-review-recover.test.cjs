const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, git, heldMutate, killedMutate, repo, run, write } = require("./review-fixture.cjs");

// The item review is where the reviewer's mutants run. A mutant a killed mutate left behind is
// put back before the review's dirty check, so it never reads as the item's uncommitted work.
// A live mutate holds only the item that owns or lists its file; items build side by side.

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const CLEAN = "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n";
const review = (fixture) => run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
const read = (fixture, file) => fs.readFileSync(path.join(fixture.root, file), "utf8");

test("an item review restores a killed mutate's mutant before its dirty check, then records", async () => {
  const fixture = repo();
  await killedMutate(fixture, fixture.root);
  write(fixture.root, REVIEW, CLEAN);
  const result = review(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^restored src\/a\.ts from an interrupted mutate$/m);
  assert.match(result.out, /review a-one clean, recorded/);
  assert.equal(read(fixture, "src/a.ts"), "export const a = 1;\n");
});

test("a live mutate on another item's file leaves this item's review alone", async () => {
  const fixture = repo();
  const held = await heldMutate(fixture, fixture.root, "src/b.ts", "export const b = 0;");
  write(fixture.root, REVIEW, CLEAN);
  const result = review(fixture);
  await held.release();
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /review a-one clean, recorded/);
  assert.equal(read(fixture, "src/b.ts"), "export const b = 2;\n");
});

test("a live mutate on the item's own file refuses its review and keeps the mutant in place", async () => {
  const fixture = repo();
  const held = await heldMutate(fixture, fixture.root);
  write(fixture.root, REVIEW, CLEAN);
  const result = review(fixture);
  const during = read(fixture, "src/a.ts");
  await held.release();
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /another mutate \(pid \d+\) is running on src\/a\.ts/);
  assert.equal(during, "export const a = 99;\n");
  assert.equal(read(fixture, "src/a.ts"), "export const a = 1;\n");
});

for (const [name, args, config, code] of [
  ["a green integrate", [], CONFIG, 0],
  ["a red integrate", [], CONFIG.replace("echo integrate ran", "false"), 2],
  ["an integrate refused for an owed review", ["--item", "a-one"], CONFIG, 3],
]) {
  test(`${name} says what it restored first`, async () => {
    const fixture = repo({ config });
    await killedMutate(fixture, fixture.root);
    const result = run(fixture, ["integrate", "--tree", fixture.root, ...args]);
    assert.equal(result.code, code, result.out + result.err);
    assert.match(result.out + result.err, /^restored src\/a\.ts from an interrupted mutate$/m);
    assert.equal(read(fixture, "src/a.ts"), "export const a = 1;\n");
  });
}

// A dead leftover under a later edit is refused by every step that recovers, whichever item
// owns the file, and nothing is written. A leftover that can go back goes back first, and the
// refusal of the other work beside it still says so.
for (const [step, args, pending] of [
  ["review --item", ["review", "--item", "a-one"], REVIEW],
  ["the intent review's record", ["review", "--intent", "alpha"], ".specs-inferno/intents/alpha/review.yaml"],
  ["gate", ["gate", "--intent", "alpha"], null],
]) {
  const killed = async () => {
    const fixture = repo();
    await killedMutate(fixture, fixture.root);
    if (pending) write(fixture.root, pending, pending === REVIEW ? CLEAN : "verdict: clean\n");
    return fixture;
  };

  test(`${step} refuses a leftover under a later edit and writes nothing`, async () => {
    const fixture = await killed();
    fs.appendFileSync(path.join(fixture.root, "src/a.ts"), "export const extra = 1;\n");
    const result = run(fixture, [...args, "--tree", fixture.root]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /MUTATE_LEFTOVER.*src\/a\.ts/);
    assert.doesNotMatch(result.out + result.err, /^restored/m);
    assert.equal(read(fixture, "src/a.ts"), "export const a = 99;\nexport const extra = 1;\n");
  });

  test(`${step} restores a leftover before it refuses other work, and the refusal says so`, async () => {
    const fixture = await killed();
    write(fixture.root, "src/a2.test.ts", "// real work\n");
    const result = run(fixture, [...args, "--tree", fixture.root]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /DIRTY\].*src\/a2\.test\.ts/);
    assert.match(result.err, /^restored src\/a\.ts from an interrupted mutate$/m);
    assert.equal(read(fixture, "src/a.ts"), "export const a = 1;\n");
  });
}

// A pending review binds every file it lists, so a live mutant or an uncommitted edit in any
// of them holds the record, even in a file another item owns.
const LISTS_B = "item: a-one\nverdict: clean\nfiles: [src/a.ts, src/b.ts]\n";

test("a live mutate on a file the pending review lists holds the record until it ends", async () => {
  const fixture = repo();
  const head = () => git(fixture.root, ["rev-parse", "HEAD"]);
  const before = head();
  const held = await heldMutate(fixture, fixture.root, "src/b.ts", "export const b = 0;");
  write(fixture.root, REVIEW, LISTS_B);
  const during = review(fixture);
  await held.release();
  assert.equal(during.code, 2, during.out + during.err);
  assert.match(during.err, /another mutate \(pid \d+\) is running on src\/b\.ts/);
  assert.equal(head(), before);
  const after = review(fixture);
  assert.equal(after.code, 0, after.out + after.err);
  assert.match(after.out, /review a-one clean, recorded/);
});

test("an uncommitted edit in a file the pending review lists is refused", () => {
  const fixture = repo();
  write(fixture.root, "src/b.ts", "export const b = 5;\n");
  write(fixture.root, REVIEW, LISTS_B);
  const result = review(fixture);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /DIRTY\].*src\/b\.ts/);
});
