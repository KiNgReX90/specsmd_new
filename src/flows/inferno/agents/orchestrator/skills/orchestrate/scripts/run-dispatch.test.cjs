'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { verifyDispatch } = require('./run-attribute.cjs');

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(tree, file, value) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  fs.writeFileSync(path.join(tree, file), value);
}
function commit(tree) { git(tree, 'add', '-A'); git(tree, 'commit', '-qm', 'fixture'); }
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-dispatch-'));
  const tree = path.join(dir, 'app'); fs.mkdirSync(tree);
  const old = process.env.XDG_CACHE_HOME; process.env.XDG_CACHE_HOME = path.join(dir, 'cache');
  t.after(() => { if (old === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = old; fs.rmSync(dir, { recursive: true, force: true }); });
  git(tree, 'init', '-q', '-b', 'main'); git(tree, 'config', 'user.name', 'Fixture'); git(tree, 'config', 'user.email', 'fixture@example.test');
  write(tree, 'src/a.ts', 'a'); write(tree, 'src/b.ts', 'b');
  write(tree, '.specs-inferno/config.yaml', 'verification:\n  finalize:\n    - echo fixture\ndelivery:\n  base_branch: main\n');
  write(tree, '.specs-inferno/state.yaml', 'intents: []\n');
  write(tree, '.specs-inferno/intents/a/work-items/one.md', '---\nstatus: pending\n---\nRequirement one\n');
  commit(tree); git(tree, 'checkout', '-qb', 'fixture');
  return { tree, write: (f, v) => write(tree, f, v), commit: () => commit(tree) };
}

function begin(f, id, editable) {
  return require('./run-dispatch.cjs').recordDispatch(f.tree, { intent: 'alpha', item: id, dispatch_id: id, editable });
}
function accept(f, id, changed_paths) {
  return require('./run-dispatch.cjs').acceptDispatch(f.tree, { dispatch_id: id, changed_paths });
}

test('sequential disjoint dispatches attribute their own patches', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  begin(f, 'a', ['src/a.ts']); f.write('src/a.ts', 'item a');
  const a = accept(f, 'a', ['src/a.ts']);
  assert.deepEqual(verifyDispatch(f.tree, a, ['src/a.ts']).outside, []); f.commit();
  begin(f, 'b', ['src/b.ts']); f.write('src/b.ts', 'item b');
  const b = accept(f, 'b', ['src/b.ts']); f.commit();
  assert.deepEqual(verifyDispatch(f.tree, b, ['src/b.ts']).outside, []);
  assert.deepEqual(verifyDispatch(f.tree, b, ['src/a.ts']).outside, ['src/b.ts']);
});

test('concurrent uncommitted patches require accepted peers and reject escaped edits', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  begin(f, 'a', ['src/a.ts']); begin(f, 'b', ['src/b.ts']);
  f.write('src/a.ts', 'item a'); f.write('src/b.ts', 'item b');
  const a = accept(f, 'a', ['src/a.ts']); const b = accept(f, 'b', ['src/b.ts']);
  assert.deepEqual(verifyDispatch(f.tree, a, ['src/a.ts'], { peers: [b] }).outside, []);
  assert.deepEqual(verifyDispatch(f.tree, b, ['src/b.ts'], { peers: [a] }).outside, []);
  assert.deepEqual(verifyDispatch(f.tree, a, ['src/a.ts'], { peers: [] }).outside, ['src/b.ts']);
  begin(f, 'escaped', ['src/a.ts']); f.write('src/a.ts', 'another a'); f.write('src/escaped.ts', 'outside');
  const escaped = accept(f, 'escaped', ['src/a.ts']);
  assert.deepEqual(verifyDispatch(f.tree, escaped, ['src/a.ts']).outside, ['src/escaped.ts']);
  assert.throws(() => verifyDispatch(f.tree, a, ['src/a.ts'], { peers: [{ ...b, phase: 'failed' }] }), /signature|accepted/i);
});

test('changed baseline bytes and forged accepted flag are refused', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  begin(f, 'a', ['src/a.ts']); f.write('src/a.ts', 'accepted change');
  const record = accept(f, 'a', ['src/a.ts']);
  record.beforeSnapshot.files['src/a.ts'].hash = 'tampered';
  assert.throws(() => verifyDispatch(f.tree, record, ['src/a.ts']), /snapshot|baseline/i);
  assert.throws(() => verifyDispatch(f.tree, { accepted: true }, ['src/a.ts']), /snapshot/i);
});

test('edits after acceptance cannot borrow the accepted snapshot', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  begin(f, 'a', ['src/a.ts']); f.write('src/a.ts', 'accepted'); const a = accept(f, 'a', ['src/a.ts']);
  f.write('src/escaped.ts', 'late edit');
  assert.deepEqual(verifyDispatch(f.tree, a, ['src/a.ts']).outside, ['src/escaped.ts']);
  f.write('src/a.ts', 'late owned edit');
  assert.throws(() => verifyDispatch(f.tree, a, ['src/a.ts']), /accepted|changed/i);
});

test('corrected native dispatch supersedes its earlier accepted attempt', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  proof.recordDispatch(f.tree, { intent: 'alpha', item: 'a', dispatch_id: 'first', editable: ['src/a.ts'] });
  f.write('src/a.ts', 'first'); const first = accept(f, 'first', ['src/a.ts']);
  proof.recordDispatch(f.tree, { intent: 'alpha', item: 'a', dispatch_id: 'correction', editable: ['src/a.ts'] });
  f.write('src/a.ts', 'corrected'); const correction = accept(f, 'correction', ['src/a.ts']);
  assert.deepEqual(verifyDispatch(f.tree, correction, ['src/a.ts']).outside, []);
  assert.throws(() => verifyDispatch(f.tree, first, ['src/a.ts']), /superseded|current/i);
});

test('prior baseline peer cannot explain a later rollback', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  begin(f, 'old-b', ['src/b.ts']); f.write('src/b.ts', 'old accepted b'); accept(f, 'old-b', ['src/b.ts']);
  // The new commit restores the peer's own baseline bytes, so only the baseline head tells them apart.
  f.write('src/b.ts', 'b'); f.write('src/other.ts', 'moves head'); f.commit();
  begin(f, 'a', ['src/a.ts']); f.write('src/a.ts', 'new a'); f.write('src/b.ts', 'old accepted b');
  const a = accept(f, 'a', ['src/a.ts']);
  assert.deepEqual(verifyDispatch(f.tree, a, ['src/a.ts']).outside, ['src/b.ts']);
});

test('dispatch-log records the baseline and accept-dispatch checks the result against it', (t) => {
  const f = fixture(t);
  f.write('.specs-inferno/intents/demo/work-items/a.md', '---\nid: a\n---\n\n## Execution Manifest\n\nownership:\n  editable: [src/a.ts]\n');
  f.commit();
  const intents = require('./run-intents.cjs');
  const started = intents.dispatchLog('demo', { cwd: f.tree, item: 'a', tier: 'strong', agent: 'builder', dispatch_id: 'native-fixture' });
  assert.equal(started.payload.dispatch_id, 'native-fixture');
  f.write('src/a.ts', 'new');
  assert.throws(() => intents.acceptDispatch('native-fixture', { cwd: f.tree, changed_paths: '["src/b.ts"]' }), /no dispatch patch/);
  const accepted = intents.acceptDispatch('native-fixture', { cwd: f.tree, changed_paths: '["src/a.ts"]' });
  assert.equal(accepted.payload.phase, 'accepted');
  const proof = require('./run-dispatch.cjs');
  const record = proof.loadDispatch(f.tree, { intent: 'demo', item: 'a' });
  assert.deepEqual(verifyDispatch(f.tree, record, ['src/**']).outside, []);
});

test('a record rewritten without the key is refused by its signature', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  begin(f, 'a', ['src/a.ts']); f.write('src/a.ts', 'new'); f.write('src/b.ts', 'escaped');
  const record = accept(f, 'a', ['src/a.ts']);
  record.beforeSnapshot.files['src/b.ts'] = record.acceptedSnapshot.files['src/b.ts'];
  record.beforeSnapshot.digest = proof.hash(record.beforeSnapshot.files);
  assert.throws(() => verifyDispatch(f.tree, record, ['src/a.ts']), /signature/);
});

test('a record copied into another tree of the same repository is refused by its tree identity', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  begin(f, 'a', ['src/a.ts']); f.write('src/a.ts', 'new'); accept(f, 'a', ['src/a.ts']);
  const other = path.join(path.dirname(f.tree), 'other');
  git(f.tree, 'worktree', 'add', '-q', '-b', 'other', other);
  const from = path.dirname(proof.recordFile(f.tree, 'a'));
  const to = path.dirname(proof.recordFile(other, 'a'));
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) fs.copyFileSync(path.join(from, name), path.join(to, name));
  assert.throws(() => proof.loadDispatch(other, { intent: 'alpha', item: 'a' }), /tree identity/);
});

test('a baseline records a submodule by its commit', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  const lib = path.join(path.dirname(f.tree), 'lib');
  fs.mkdirSync(lib);
  git(lib, 'init', '-q', '-b', 'main'); git(lib, 'config', 'user.name', 'Fixture'); git(lib, 'config', 'user.email', 'fixture@example.test');
  write(lib, 'x', 'x'); git(lib, 'add', '-A'); git(lib, 'commit', '-qm', 'lib');
  git(f.tree, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'vendor/lib'); f.commit();
  begin(f, 'a', ['src/a.ts']);
  write(path.join(f.tree, 'vendor/lib'), 'x', 'moved'); git(path.join(f.tree, 'vendor/lib'), 'commit', '-qam', 'moved');
  const record = accept(f, 'a', []);
  assert.deepEqual(verifyDispatch(f.tree, record, ['src/a.ts']).outside, ['vendor/lib']);
});

test('a dispatch snapshot waits while another of the same tree holds the sequence, and names the holder when it gives up', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  const lock = path.join(proof.dispatchDirectory(f.tree), 'sequence.lock');
  const hold = () => {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, start: null, since: 'a moment ago', token: 'holder' }));
  };
  hold();
  let polls = 0;
  const snapshot = proof.sequencedSnapshot(f.tree, { sleep: () => { polls += 1; if (polls === 3) fs.rmSync(lock); } });
  assert.equal(polls, 3);
  assert.equal(snapshot.seq, 1);
  const gone = require('node:child_process').spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(lock, JSON.stringify({ pid: gone, start: null, since: 'a moment ago', token: 'gone' }));
  assert.equal(proof.sequencedSnapshot(f.tree, { wait: 0, sleep: () => {} }).seq, 2);
  if (fs.existsSync('/proc/self/stat')) {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, start: 'an earlier process', since: 'a moment ago', token: 'reused' }));
    assert.equal(proof.sequencedSnapshot(f.tree, { wait: 0, sleep: () => {} }).seq, 3);
  }
  hold();
  assert.throws(() => proof.sequencedSnapshot(f.tree, { wait: 0, sleep: () => {} }),
    new RegExp(`sequence lock ${lock.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} is held by pid ${process.pid}[\\s\\S]*run this step again`));
});

test('a warm snapshot takes an unchanged file from the tree\'s index and reads a changed one again', (t) => {
  const f = fixture(t); const proof = require('./run-dispatch.cjs');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
  proof.sequencedSnapshot(f.tree);
  const index = path.join(proof.dispatchDirectory(f.tree), 'index.json');
  const stored = JSON.parse(fs.readFileSync(index, 'utf8'));
  stored['src/a.ts'].hash = 'from the index';
  fs.writeFileSync(index, JSON.stringify(stored));
  assert.equal(proof.sequencedSnapshot(f.tree).files['src/a.ts'].hash, 'from the index');
  f.write('src/a.ts', 'changed');
  assert.notEqual(proof.sequencedSnapshot(f.tree).files['src/a.ts'].hash, 'from the index');
});
