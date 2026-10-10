const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { writeFile } = require('./test-write.cjs');

const {
  BRANCH, acceptLine, commit, config, fixture, gated, git, harnessFix, laneRuns, passed, red, run, touch, write,
} = require('./run-lanes-fixture.cjs');

test('a lane starts only when the branch touched its scope', (t) => {
  const f = fixture(t);
  touch(f, 'docs/readme.txt');
  const started = run(f, 'gate', '--detach');
  passed(started);
  assert.match(started.out, /SKIP smoke \(no path in scope changed\)/);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  assert.deepEqual(laneRuns(f), []);
  const skipped = run(f, 'green');
  passed(skipped);
  assert.match(skipped.out, /SKIP smoke \(no path in scope changed\)/);
  touch(f);
  const again = run(f, 'gate', '--detach');
  passed(again);
  assert.match(again.out, /smoke lane started pid \d+/);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  assert.deepEqual(laneRuns(f), ['smoke']);
});

test('gate --wait exits 4 while a lane runs and 0 once the gate and every lane are green', (t) => {
  const f = fixture(t, config({ smoke: '0', windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const running = run(f, 'gate', '--wait', '--minutes', '0.03');
  assert.equal(running.code, 4, running.out + running.err);
  assert.match(running.out, /windows lane still running pid \d+/);
  writeFile(f.release, '');
  const done = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(done);
  assert.match(done.out, /GREEN lane smoke/);
  assert.match(done.out, /GREEN lane windows/);
});

test('gate --wait exits 2 on a product red lane and on a red gate', (t) => {
  const product = fixture(t, config({ smoke: '10' }));
  touch(product);
  const result = gated(product);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /RED lane smoke: product red \(exit 10\)/);

  const gateRed = fixture(t, config({ smoke: '0' }, [red]));
  touch(gateRed);
  const redGate = gated(gateRed);
  assert.equal(redGate.code, 2, redGate.out + redGate.err);
  assert.match(redGate.out, /FAIL \d+s node proof\.cjs red/);
});

test('exit 11 and any code other than 0 and 10 count as instrument red', (t) => {
  for (const code of ['11', '3']) {
    const f = fixture(t, config({ smoke: code }));
    touch(f);
    const result = gated(f);
    assert.equal(result.code, 3, result.out + result.err);
    assert.match(result.out, new RegExp(`INSTRUMENT RED lane smoke \\(exit ${code}\\)`));
    assert.match(result.out, /smoke --accept --harness-fix <sha>/);
    assert.doesNotMatch(result.out, /product red/);
  }
});

test('smoke --accept refuses a sha off the base branch and records one on it, which green accepts', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  touch(f);
  const onBranch = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', 'main');
  write(f.tree, 'harness.txt', 'fixed\n');
  commit(f.tree, 'harness fix');
  const fix = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', BRANCH);
  git(f.tree, 'merge', '-q', '--no-edit', 'main');
  gated(f);
  assert.equal(run(f, 'green').code, 3);

  const off = run(f, 'smoke', '--accept', '--harness-fix', onBranch);
  assert.equal(off.code, 2, off.out + off.err);
  assert.match(off.err, /not on main/);
  assert.equal(run(f, 'smoke', '--accept').code, 1);

  const accepted = run(f, 'smoke', '--accept', '--harness-fix', fix);
  passed(accepted);
  assert.match(accepted.out, new RegExp(`accepted smoke instrument red against harness fix ${fix.slice(0, 7)}`));
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  const verdict = run(f, 'green');
  passed(verdict);
  assert.match(verdict.out, /ACCEPTED smoke instrument red, harness fix [0-9a-f]{7}/);
});

test('smoke --accept refuses a tree whose smoke lane did not end instrument red', (t) => {
  const f = fixture(t, config({ smoke: '0' }));
  touch(f);
  passed(gated(f));
  const refused = run(f, 'smoke', '--accept', '--harness-fix', git(f.tree, 'rev-parse', 'main'));
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /no instrument red/);
});

test('green owes the smoke lane in scope, and skips it with no lane configured', (t) => {
  const f = fixture(t);
  touch(f);
  passed(run(f, 'gate'));
  const owed = run(f, 'green', '--json');
  assert.equal(owed.code, 3, owed.out + owed.err);
  assert.deepEqual(JSON.parse(owed.out).owed, ['smoke']);
  assert.match(run(f, 'green').out, /smoke owed: .*gate --detach.*then node \S+run\.cjs gate --wait/);
  passed(gated(f));
  passed(run(f, 'green'));

  const none = fixture(t, config({}));
  touch(none);
  passed(run(none, 'gate'));
  const skipped = run(none, 'green');
  passed(skipped);
  assert.match(skipped.out, /SKIP smoke \(no verification\.smoke in \.specs-inferno\/config\.yaml\)/);
});

test('a lane proof is keyed by the lane scope, so an edit outside it keeps the lane green', (t) => {
  const f = fixture(t);
  touch(f);
  passed(gated(f));
  touch(f, 'docs/readme.txt');
  const kept = run(f, 'gate', '--detach');
  passed(kept);
  assert.match(kept.out, /GREEN lane smoke \(unchanged since [^)]+\)/);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  passed(run(f, 'green'));
  assert.deepEqual(laneRuns(f), ['smoke']);
  touch(f);
  passed(gated(f));
  assert.deepEqual(laneRuns(f), ['smoke', 'smoke']);
});

test('an unaccepted instrument red exits 3, owes its lane and prints the accept line last', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  touch(f);
  const result = gated(f);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out.trim().split('\n').pop(), acceptLine('smoke'));
  const json = run(f, 'gate', '--wait', '--minutes', '0.5', '--json');
  assert.equal(json.code, 3);
  assert.deepEqual(JSON.parse(json.out).owed, ['smoke']);
  assert.equal(JSON.parse(json.out).ok, false);
});

test('a windows instrument red is accepted by the windows --accept line gate --wait prints', (t) => {
  const f = fixture(t, config({ smoke: '0', windows: '11' }));
  touch(f);
  const fix = harnessFix(f);
  const result = gated(f);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out.trim().split('\n').pop(), acceptLine('windows'));
  const accepted = run(f, 'windows', '--accept', '--harness-fix', fix);
  passed(accepted);
  assert.match(accepted.out, new RegExp(`^accepted windows instrument red against harness fix ${fix.slice(0, 7)} for this tree$`, 'm'));
  assert.match(accepted.out, /^wait with: node \S+run\.cjs gate --wait --tree \S+$/m);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
});

test('each lane accepts only its own instrument red', (t) => {
  const f = fixture(t, config({ smoke: '11', windows: '11' }));
  touch(f);
  const fix = harnessFix(f);
  gated(f);
  passed(run(f, 'smoke', '--accept', '--harness-fix', fix));
  const result = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /INSTRUMENT RED lane windows/);
  assert.doesNotMatch(result.out, /INSTRUMENT RED lane smoke/);
  assert.match(result.out.trim().split('\n').pop(), acceptLine('windows'));
});

test('an accepted instrument red never outlives the run it accepted', (t) => {
  const f = fixture(t, config({ smoke: 'file' }));
  writeFile(f.code, '11');
  touch(f);
  const fix = harnessFix(f);
  assert.equal(gated(f).code, 3);
  passed(run(f, 'smoke', '--accept', '--harness-fix', fix));
  writeFile(f.code, '10');
  const rerun = gated(f, '--force');
  assert.equal(rerun.code, 2, rerun.out + rerun.err);
  assert.match(rerun.out, /RED lane smoke: product red \(exit 10\)/);
  const verdict = run(f, 'green', '--json');
  assert.equal(verdict.code, 3, verdict.out + verdict.err);
  assert.deepEqual(JSON.parse(verdict.out).owed, ['smoke']);
  // A new instrument red on the same tree is a new run, and the old acceptance does not cover it.
  writeFile(f.code, '11');
  const again = gated(f, '--force');
  assert.equal(again.code, 3, again.out + again.err);
  assert.match(again.out, /INSTRUMENT RED lane smoke \(exit 11\)/);
  assert.equal(run(f, 'green').code, 3);
});

test('smoke --accept binds only the tree the instrument red ran on', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  touch(f);
  const fix = harnessFix(f);
  assert.equal(gated(f).code, 3);
  touch(f);
  const refused = run(f, 'smoke', '--accept', '--harness-fix', fix);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /no instrument red of the smoke lane on this tree to accept/);
  assert.ok(refused.err.includes(`run.cjs gate --detach --tree ${f.tree}`), refused.err);
  assert.ok(refused.err.includes(`then node `) && refused.err.includes(` gate --wait --tree ${f.tree}`), refused.err);
  const verdict = run(f, 'green', '--json');
  assert.equal(verdict.code, 3);
  assert.deepEqual(JSON.parse(verdict.out).owed, ['smoke']);
});
