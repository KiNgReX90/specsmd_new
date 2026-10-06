'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const WRITER = path.join(__dirname, 'state-transition.cjs');
const LINUX = process.platform === 'linux' && fs.existsSync('/proc/self/stat');

const identity = { pid: 400000, starttime: '100', boot_id: 'boot', command: 'node task', cwd: '/fixture/tree', run_id: 'run-a' };

test('a reused pid, a foreign cwd and a vanished identity never receive a signal', () => {
  const owned = require('./run-processes.cjs');
  const calls = [];
  for (const current of [{ ...identity, starttime: '200' }, { ...identity, cwd: '/unrelated' }, null]) {
    const stopped = owned.stopOwnedProcesses({ run_id: 'run-a', tree: '/fixture/tree', processes: [identity] }, {
      inspect: () => current, kill: (...args) => calls.push(args),
    });
    assert.deepEqual(stopped, []);
  }
  assert.deepEqual(calls, []);
});

test('only identities registered by the owning run are stopped', () => {
  const owned = require('./run-processes.cjs');
  const calls = [];
  const record = { run_id: 'run-a', tree: '/fixture/tree', processes: [identity, { ...identity, pid: 400001, run_id: 'run-b' }] };
  const stopped = owned.stopOwnedProcesses(record, { inspect: (pid) => ({ ...identity, pid }), kill: (...args) => calls.push(args) });
  assert.deepEqual(stopped, [400000]);
  assert.deepEqual(calls, [[400000, 'SIGTERM']]);
});

test('a tree with no ownership record signals nothing', () => {
  const owned = require('./run-processes.cjs');
  assert.deepEqual(owned.stopOwnedProcesses(null, { kill: () => assert.fail('signalled') }), []);
});

// --- through the CLI -------------------------------------------------------
const STATE = `intents:
  - id: alpha
    title: "Alpha"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items: []
`;
const CONFIG = `verification:
  finalize:
    - echo always
delivery:
  mode: auto-close
  base_branch: main
`;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-processes-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'app');
  const remote = path.join(dir, 'remote.git');
  git(dir, ['init', '--bare', '-q', remote]);
  git(dir, ['init', '-q', '-b', 'main', root]);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  write(root, 'src/a.ts', 'export const a = 1;\n');
  write(root, '.specs-inferno/state.yaml', STATE);
  write(root, '.specs-inferno/config.yaml', CONFIG);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-qu', 'origin', 'main']);
  const env = { ...process.env, XDG_CACHE_HOME: path.join(dir, 'cache'), INFERNO_FLOW_BUDGET: path.join(dir, 'no-budget') };
  const run = (args) => {
    const result = spawnSync(process.execPath, [RUN, ...args], { cwd: root, encoding: 'utf8', env });
    return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
  };
  return { dir, root, run };
}

/** Claim alpha, open its worktree, close the intent in it and pass the gate. */
function closed(t) {
  const fx = fixture(t);
  assert.equal(fx.run(['claim', 'alpha']).code, 0);
  const made = JSON.parse(fx.run(['worktree', 'alpha', '--json']).out);
  const state = path.join(made.path, '.specs-inferno/state.yaml');
  execFileSync(process.execPath, [WRITER, 'close-intent', '--intent', 'alpha', '--file', state], { cwd: made.path });
  write(made.path, 'src/a.ts', 'export const a = 7;\n');
  git(made.path, ['commit', '-qam', 'the work and the close']);
  const gated = fx.run(['gate', '--tree', made.path]);
  assert.equal(gated.code, 0, gated.out + gated.err);
  return { ...fx, tree: made.path, branch: made.branch };
}

function sleeper(t, cwd) {
  const child = spawn('sleep', ['60'], { cwd, stdio: 'ignore' });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal || code)));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  return { child, exited };
}
const settle = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('running'), ms))]);

test('ship stops the process the run registered and leaves an unregistered one in the tree alone', { skip: !LINUX }, async (t) => {
  const fx = closed(t);
  const registered = sleeper(t, fx.tree);
  const stranger = sleeper(t, path.join(fx.tree, 'src'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const added = fx.run(['register-process', String(registered.child.pid), '--tree', fx.tree, '--run-id', fx.branch]);
  assert.equal(added.code, 0, added.out + added.err);

  const shipped = fx.run(['ship', 'alpha', '--tree', fx.tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.match(shipped.out, /stopped 1 process/);
  assert.equal(await settle(registered.exited, 5000), 'SIGTERM');
  assert.equal(await settle(stranger.exited, 300), 'running');
});

test('register-process refuses another run and a process outside the tree', { skip: !LINUX }, async (t) => {
  const fx = fixture(t);
  assert.equal(fx.run(['claim', 'alpha']).code, 0);
  const made = JSON.parse(fx.run(['worktree', 'alpha', '--json']).out);
  const inside = sleeper(t, made.path);
  const outside = sleeper(t, fx.dir);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const wrongRun = fx.run(['register-process', String(inside.child.pid), '--tree', made.path, '--run-id', 'inferno-intent/alpha-other']);
  assert.equal(wrongRun.code, 2);
  assert.match(wrongRun.err, /PROCESS_OWNER/);
  const foreign = fx.run(['register-process', String(outside.child.pid), '--tree', made.path, '--run-id', made.branch]);
  assert.equal(foreign.code, 2);
  assert.match(foreign.err, /PROCESS_OWNER/);
});

test('ship refuses the primary checkout before any merge, push or signal', (t) => {
  const fx = fixture(t);
  write(fx.root, '.specs-inferno/state.yaml', STATE.replace('status: pending', 'status: completed'));
  git(fx.root, ['commit', '-qam', 'completed in the primary ledger']);
  const head = git(fx.root, ['rev-parse', 'HEAD']);
  const result = fx.run(['ship', 'alpha', '--tree', fx.root]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /primary checkout/);
  assert.equal(git(fx.root, ['rev-parse', 'HEAD']), head);
});

test('ship refuses the worktree of another intent', (t) => {
  const fx = fixture(t);
  const foreign = path.join(fx.dir, 'foreign');
  git(fx.root, ['worktree', 'add', '-q', '-b', 'inferno-intent/beta-00000000T000000Z', foreign]);
  const result = fx.run(['ship', 'alpha', '--tree', foreign]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /not the worktree of alpha/);
});
