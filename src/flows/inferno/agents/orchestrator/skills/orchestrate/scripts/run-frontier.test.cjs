const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { fixture, run } = require("./run-frontier-fixture.cjs");

// --- ownership closure ---------------------------------------------------
test("frontier names a test file that references an owned export", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "alpha"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(
    result.out,
    /candidate a-tile src\/board\/tile\.test\.ts references src\/board\/tile\.ts via renderTile/,
  );
});

test("frontier leaves a hit inside the item's own ownership alone", () => {
  const tree = fixture();
  assert.doesNotMatch(run(tree, ["frontier", "alpha"]).out, /candidate a-panel/);
});

test("frontier names the open item that owns a candidate hit", () => {
  const tree = fixture();
  const payload = JSON.parse(run(tree, ["frontier", "alpha", "--json"]).out);
  const hit = payload.candidates.find((entry) => entry.path === "scripts/check-tiles.mjs");
  assert.ok(hit, "the script that references the owned export is a candidate");
  assert.equal(hit.ownedBy, "a-scripts");
  assert.match(
    run(tree, ["frontier", "alpha"]).out,
    /candidate a-tile scripts\/check-tiles\.mjs owned-by a-scripts via renderTile/,
  );
});

test("frontier outside a git repository prints no candidate and stays green", () => {
  const tree = fixture({ git: false });
  const result = run(tree, ["frontier", "alpha", "--tree", tree.root]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.doesNotMatch(result.out, /candidate/);
});

test("an owned test file lends its name to nothing", () => {
  const tree = fixture();
  assert.doesNotMatch(run(tree, ["frontier", "alpha"]).out, /candidate a-dash/);
});

test("a basename counts as a reference only where it names a module", () => {
  const tree = fixture();
  assert.doesNotMatch(run(tree, ["frontier", "alpha"]).out, /e2e\/board\.spec\.ts/);
});

test("a symbol counts as a reference only as a whole word", () => {
  const tree = fixture();
  assert.doesNotMatch(run(tree, ["frontier", "alpha"]).out, /e2e\/board-wide\.spec\.ts/);
});

test("a key that hits half the suite is skipped as generic evidence", () => {
  const tree = fixture();
  const out = run(tree, ["frontier", "gamma"]).out;
  assert.match(out, /skipped g-generic evaluate \(7 hits\)/);
  assert.doesNotMatch(out, /candidate g-generic/);
});

test("candidates stop at ten lines for one item and count the rest", () => {
  const tree = fixture();
  const out = run(tree, ["frontier", "gamma"]).out;
  const named = out.split("\n").filter((line) => line.startsWith("candidate g-wide "));
  assert.equal(named.length, 10);
  assert.match(out, /candidates g-wide and 2 more/);
});

test("a serialize line always precedes the candidates the cap trims", () => {
  const tree = fixture();
  const printed = run(tree, ["frontier", "gamma"]).out.split("\n");
  const serialize = printed.findIndex((line) => line.startsWith("serialize "));
  const candidate = printed.findIndex((line) => line.startsWith("candidate "));
  assert.ok(serialize >= 0, "the shared ownership is still reported");
  assert.ok(candidate > serialize, "candidates come after the serialize lines");
});

test("a folder owner and a file below it are serialized and never dispatched together", () => {
  const tree = fixture();
  const payload = JSON.parse(run(tree, ["frontier", "zeta", "--json"]).out);
  assert.deepEqual(payload.serialize.map((entry) => entry.items), [["z-dir", "z-file"]]);
  assert.deepEqual(payload.dispatch, ["z-dir"]);
});

test("a hit under a folder the item owns through a symlinked alias is not its candidate", () => {
  const tree = fixture();
  fs.symlinkSync("src/board", path.join(tree.root, "alias"));
  const result = run(tree, ["frontier", "iota"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.doesNotMatch(result.out, /candidate i-alias src\/board\/tile\.test\.ts/);
  assert.match(run(tree, ["frontier", "alpha"]).out, /candidate a-tile src\/board\/tile\.test\.ts/);
});

