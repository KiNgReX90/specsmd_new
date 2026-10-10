const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { acceptLine, cacheOf, config, fixture, gated, passed, run, touch, whole } = require('./run-lanes-fixture.cjs');
const { writeFile } = require('./test-write.cjs');

const lines = (result) => result.out.trim().split('\n');

/** Wait in short slices until the gate itself is done and only lanes may still run. */
function gateDone(f) {
  for (let i = 0; i < 20; i += 1) {
    const result = run(f, 'gate', '--wait', '--minutes', '0.05');
    if (!/gate still running/.test(result.out)) return result;
  }
  throw new Error('the gate never finished');
}

test('a red lane exits 2 at once, while another lane still runs', (t) => {
  const f = fixture(t, config({ smoke: '10', windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  let result;
  for (let i = 0; i < 20 && !(result && result.code === 2); i += 1) result = run(f, 'gate', '--wait', '--minutes', '0.05');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /RED lane smoke: product red/);
  assert.match(result.out, /windows lane still running pid \d+/);
});

test('a running lane exits 4 before an unbounded instrument red exits 3', (t) => {
  const f = fixture(t, config({ smoke: '11', windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const running = gateDone(f);
  assert.equal(running.code, 4, running.out + running.err);
  assert.match(running.out, /INSTRUMENT RED lane smoke/);
  writeFile(f.release, '');
  const done = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(done.code, 3, done.out + done.err);
});

test('a lane process that died without a result is red', (t) => {
  const f = fixture(t, config({ windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const job = JSON.parse(fs.readFileSync(path.join(cacheOf(f), 'lane-windows-job.json'), 'utf8'));
  process.kill(job.pid, 'SIGKILL');
  writeFile(f.release, '');
  const result = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, new RegExp(`lane windows process ${job.pid} ended without a result`));
});

test('a lane whose scope changed while it ran is red and mints no proof', (t) => {
  const f = fixture(t, config({ smoke: 'movewait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  assert.equal(gateDone(f).code, 4);
  writeFile(f.release, '');
  const result = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /RED lane smoke: the code changed while the lane ran/);
  fs.rmSync(path.join(f.tree, 'src/moved.txt'));
  const verdict = run(f, 'green', '--json');
  assert.equal(verdict.code, 3, verdict.out + verdict.err);
  assert.deepEqual(JSON.parse(verdict.out).owed, ['smoke']);
});

test('the accept line is last even when the unbounded lane comes first', (t) => {
  const f = fixture(t, config({ smoke: '11', windows: '0' }));
  touch(f);
  const result = gated(f);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(lines(result).pop(), acceptLine('smoke'));
});

test('a gate block past the output cap never cuts the accept line', (t) => {
  const many = Array.from({ length: 30 }, (_, index) => `${whole}-${index}`);
  const f = fixture(t, config({ smoke: '11' }, many));
  touch(f);
  const result = gated(f);
  assert.equal(result.code, 3, result.out + result.err);
  assert.ok(lines(result).length <= 30, result.out);
  assert.match(lines(result).pop(), acceptLine('smoke'));
});

test('gate --detach refuses while a lane of the earlier gate still runs', (t) => {
  const f = fixture(t, config({ windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  assert.equal(gateDone(f).code, 4);
  const again = run(f, 'gate', '--detach');
  assert.equal(again.code, 2, again.out + again.err);
  assert.match(again.err, /a windows lane is already running for this tree \(pid \d+, .*\); wait for it: node \S+run\.cjs gate --wait/);
});
