const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture, run } = require("./run-frontier-fixture.cjs");

// --- probes --------------------------------------------------------------
test("probes stay green while every measurement still holds", () => {
  const tree = fixture();
  const result = run(tree, ["probes", "b-ok"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /probe ok b-ok grep -c radius src\/board\/tile\.css/);
  assert.match(result.out, /probe ok b-ok test -f src\/board\/tile\.ts/);
});

test("probes report a count the tree has moved past", () => {
  const tree = fixture();
  const result = run(tree, ["probes", "b-drift", "--intent", "beta"]);
  assert.equal(result.code, 2);
  assert.match(result.out, /drift b-drift grep -c radius src\/board\/tile\.css expected 9 got 2/);
  const payload = JSON.parse(run(tree, ["probes", "b-drift", "--json"]).out);
  assert.equal(payload.ok, false);
  assert.equal(payload.probes[0].got, "2");
});

test("probes treat a command that fails as drift", () => {
  const tree = fixture();
  const result = run(tree, ["probes", "b-fail"]);
  assert.equal(result.code, 2);
  assert.match(result.out, /drift b-fail cat src\/board\/nope\.css expected 8 got exit 1/);
});

// An item that corrects nothing measures nothing: `probes:` stays optional. The corrective
// items below are the ones that owe evidence, and the cases after this one prove it.
test("an item that corrects nothing needs no measurement", () => {
  const tree = fixture();
  const result = run(tree, ["probes", "a-panel"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /no probes a-panel/);
});

// --- diagnosis evidence on a corrective item -----------------------------
// One item of 2026-09-09 named a pixel cause it had never measured (the dials in
// board-fit.css) while the real cause was a hundred pixels of shelf foot. A corrective ui or
// behavior item now carries the claim, the probe that shows it, and what the probe printed,
// and the frontier replays the probe on the dispatch tree before anything is dispatched.

test("a corrective item with no diagnosis block blocks its dispatch", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "delta"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /INVALID d-missing: .*diagnosis/);
});

test("a diagnosis whose probe no longer prints what it showed blocks its dispatch", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "epsilon"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /INVALID e-stale: diagnosis probe .* expected 9 got 2/);
});

test("a diagnosis whose probe fails blocks its dispatch", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "epsilon"]);
  assert.match(result.out, /INVALID e-fails: diagnosis probe .* got exit 1/);
});

test("a corrective item whose evidence still holds is dispatchable", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "theta"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /ready t-fresh/);
  assert.match(result.out, /ready t-clean/);
});

test("probes replays the diagnosis beside the item's own measurements", () => {
  const tree = fixture();
  assert.match(run(tree, ["probes", "t-fresh"]).out, /diagnosis ok t-fresh/);
  assert.equal(run(tree, ["probes", "e-stale"]).code, 2);
});

test("frontier refuses a probe that carries no command", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "beta"]);
  assert.equal(result.code, 2);
  assert.match(result.out, /INVALID b-bad: probes\[0\]\.run/);
});
