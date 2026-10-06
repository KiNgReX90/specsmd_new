'use strict';

// Ledger transactions across processes: one lock per repository ledger, a generation check
// before every write, an atomic replace, an archive that resumes where it was interrupted,
// and claim commits that carry only the ledger's own paths.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const runtime = require.resolve('./state-transition.cjs');
const writer = require(runtime);

function fixture(t, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-transactions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.yaml');
  fs.writeFileSync(file, body);
  return { dir, file };
}

// A child claims after its first read of the ledger, and waits there briefly for its peer
// to read too, so an unserialized writer would let both see `pending`.
function child(file, intent, run) {
  return new Promise((resolve) => {
    const code = `const w=require(${JSON.stringify(runtime)}); const fs=require('fs'); const file=${JSON.stringify(file)}; const run=${JSON.stringify(run)}; const read=fs.readFileSync; let first=true;
      fs.readFileSync=function(target,...args){const value=read.call(this,target,...args); if(String(target)===file&&first){first=false; fs.writeFileSync(file+'.ready-'+run,'ready'); const until=Date.now()+500; while(Date.now()<until&&fs.readdirSync(require('path').dirname(file)).filter(name=>name.startsWith('state.yaml.ready-')).length<2)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);} return value;};
      try { w.claimIntent({file,intent:${JSON.stringify(intent)},run}); process.exit(0); } catch(e) { process.stderr.write(e.code||e.message); process.exit(2); }`;
    const proc = spawn(process.execPath, ['-e', code]);
    let error = '';
    proc.stderr.on('data', (chunk) => { error += chunk; });
    proc.on('exit', (status) => resolve({ status, error }));
  });
}

test('concurrent claims of one intent have one winner', async (t) => {
  const { file } = fixture(t, 'intents:\n  - id: a\n    status: pending\n');
  const results = await Promise.all([child(file, 'a', 'one'), child(file, 'a', 'two')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [0, 2]);
});

test('concurrent claims of two intents preserve both changes', async (t) => {
  const { file } = fixture(t, 'intents:\n  - id: a\n    status: pending\n  - id: b\n    status: pending\n');
  const results = await Promise.all([child(file, 'a', 'one'), child(file, 'b', 'two')]);
  assert.deepEqual(results.map((r) => r.status), [0, 0]);
  assert.equal((fs.readFileSync(file, 'utf8').match(/status: in_progress/g) || []).length, 2);
});

test('an interrupted atomic replace leaves the old bytes', (t) => {
  const { file } = fixture(t, 'intents:\n  - id: a\n    status: pending\n');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => writer.claimIntent({
    file, intent: 'a', failpoint(at) { if (at === 'before-rename') throw Error('interrupted'); },
  }), /interrupted/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp')), []);
});

test('concurrent reclaimers of a stale lock cannot remove a new owner', async (t) => {
  const { file } = fixture(t, 'intents:\n  - id: a\n    status: pending\n');
  const { lockPath } = require('./state-store.cjs');
  fs.writeFileSync(lockPath(file), JSON.stringify({ pid: 99999999, token: 'dead-owner' }));
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => child(file, 'a', `run-${i}`)));
  assert.equal(results.filter((result) => result.status === 0).length, 1);
});

test('a ledger changed outside the lock is refused, not overwritten', (t) => {
  const { file } = fixture(t, 'intents:\n  - id: a\n    status: pending\n');
  assert.throws(() => writer.claimIntent({
    file, intent: 'a', afterRead() { fs.appendFileSync(file, '# External edit.\n'); },
  }), (error) => error.code === 'STATE_GENERATION');
  assert.match(fs.readFileSync(file, 'utf8'), /status: pending/);
  assert.match(fs.readFileSync(file, 'utf8'), /External edit/);
});

test('concurrent completions preserve different item updates', async (t) => {
  const { file } = fixture(t, 'intents:\n  - id: a\n    status: in_progress\n    work_items:\n      - id: first\n        review: clean\n        status: pending\n      - id: second\n        review: clean\n        status: pending\n');
  const complete = (item) => new Promise((resolve) => {
    const code = `require(${JSON.stringify(runtime)}).completeItem({file:${JSON.stringify(file)},intent:'a',item:${JSON.stringify(item)},proof:'abc1234',afterRead(){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150)}})`;
    const worker = spawn(process.execPath, ['-e', code]);
    worker.on('exit', resolve);
  });
  assert.deepEqual(await Promise.all([complete('first'), complete('second')]), [0, 0]);
  assert.equal((fs.readFileSync(file, 'utf8').match(/status: completed/g) || []).length, 2);
});

test('block and unblock write through the same lock and generation check', (t) => {
  const { file } = fixture(t, 'intents:\n  - id: a\n    status: pending\n');
  assert.throws(() => writer.blockIntent({
    file, intent: 'a', reason: 'waits on a decision', afterRead() { fs.appendFileSync(file, '# External edit.\n'); },
  }), (error) => error.code === 'STATE_GENERATION');
  assert.match(fs.readFileSync(file, 'utf8'), /status: pending/);
});

function archiveFixture(t, body) {
  const made = fixture(t, body);
  fs.mkdirSync(path.join(made.dir, 'intents/a'), { recursive: true });
  fs.writeFileSync(path.join(made.dir, 'intents/a/brief.md'), 'artifact');
  return made;
}

function assertArchivedOnce(dir, file) {
  assert.equal((fs.readFileSync(path.join(dir, 'archive/state.yaml'), 'utf8').match(/- id: a/g) || []).length, 1);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /- id: a\n/);
  assert.equal(fs.readFileSync(path.join(dir, 'archive/intents/a/brief.md'), 'utf8'), 'artifact');
  assert.equal(fs.existsSync(path.join(dir, 'intents/a')), false);
}

for (const phase of ['archive', 'live', 'artifacts']) {
  test(`an archive interrupted after its ${phase} phase resumes on retry`, (t) => {
    const { file, dir } = archiveFixture(t, 'intents:\n  - id: a\n    status: completed\n  - id: b\n    status: pending\n    depends_on_intents: [a]\n    # Preserve this reason.\n');
    assert.throws(() => writer.archiveIntent({
      file, intent: 'a', failpoint(at) { if (at === phase) throw Error('interrupted'); },
    }), /interrupted/);
    writer.archiveIntent({ file, intent: 'a' });
    assertArchivedOnce(dir, file);
    assert.match(fs.readFileSync(file, 'utf8'), /Preserve this reason/);
    assert.match(fs.readFileSync(file, 'utf8'), /Prerequisite a completed/);
  });

  test(`an archive whose writer exits during ${phase} resumes on retry`, (t) => {
    const { file, dir } = archiveFixture(t, 'intents:\n  - id: a\n    status: completed\n');
    const script = `require(${JSON.stringify(runtime)}).archiveIntent({file:${JSON.stringify(file)},intent:'a',failpoint(at){if(at===${JSON.stringify(phase)})process.exit(93)}})`;
    assert.equal(spawnSync(process.execPath, ['-e', script]).status, 93);
    const retry = writer.archiveIntent({ file, intent: 'a' });
    assert.equal(retry.changed, true);
    assertArchivedOnce(dir, file);
  });
}

test('the next ledger write finishes an interrupted archive first', (t) => {
  const { file, dir } = archiveFixture(t, 'intents:\n  - id: a\n    status: completed\n  - id: b\n    status: pending\n');
  assert.throws(() => writer.archiveIntent({
    file, intent: 'a', failpoint(at) { if (at === 'archive') throw Error('interrupted'); },
  }), /interrupted/);
  writer.claimIntent({ file, intent: 'b', run: 'next' });
  assertArchivedOnce(dir, file);
  assert.match(fs.readFileSync(file, 'utf8'), /claimed_by: next/);
});

test('conflicting artifact destinations are refused as repairable', (t) => {
  const { dir, file } = fixture(t, 'intents:\n  - id: a\n    status: completed\n');
  for (const sub of ['intents/a', 'archive/intents/a']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  assert.throws(() => writer.archiveIntent({ file, intent: 'a' }), (error) => error.code === 'ARCHIVE_CONFLICT');
});

function claimRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-claim-commit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (rel, value) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), value);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  git('config', 'commit.gpgsign', 'false');
  put('.specs-inferno/state.yaml', 'intents:\n  - id: a\n    status: pending\n    base_branch: main\n');
  put('.specs-inferno/config.yaml', 'delivery:\n  base_branch: main\n');
  put('unrelated.txt', 'first\nlast\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  return { root, git, put };
}

test('claim and unclaim commit only the ledger paths and keep unrelated partial staging', (t) => {
  process.env.INFERNO_FLOW_BUDGET = path.join(os.tmpdir(), 'no-flow-budget-script.py');
  const intents = require('./run-intents.cjs');
  const { root, git, put } = claimRepo(t);
  put('unrelated.txt', 'staged\nlast\n');
  git('add', 'unrelated.txt');
  put('unrelated.txt', 'staged\nunstaged\n');
  put('.specs-inferno/intents/a/brief.md', 'brief');
  const staged = git('diff', '--cached');
  const work = fs.readFileSync(path.join(root, 'unrelated.txt'));

  intents.claim('a', { cwd: root, run: 'fixture' });
  assert.deepEqual(git('show', '--format=', '--name-only', 'HEAD').split('\n').sort(),
    ['.specs-inferno/intents/a/brief.md', '.specs-inferno/state.yaml']);
  assert.equal(git('diff', '--cached'), staged);
  assert.deepEqual(fs.readFileSync(path.join(root, 'unrelated.txt')), work);

  intents.unclaim('a', { cwd: root });
  assert.deepEqual(git('show', '--format=', '--name-only', 'HEAD').split('\n'), ['.specs-inferno/state.yaml']);
  assert.equal(git('diff', '--cached'), staged);
  assert.deepEqual(fs.readFileSync(path.join(root, 'unrelated.txt')), work);
});
