'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.INFERNO_FLOW_BUDGET = path.join(os.tmpdir(), 'inferno-no-flow-budget');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const intents = require('./run-intents.cjs');

function fixture(t, config) {
  const dir = fs.realpathSync(tempDir('inferno-worktrees-'));
  const root = path.join(dir, 'repo');
  fs.mkdirSync(root);
  const priorCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(dir, 'cache');
  t.after(() => {
    if (priorCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = priorCache;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (rel, value) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFile(path.join(root, rel), value);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  put('.specs-inferno/state.yaml', 'intents:\n  - id: a\n    status: pending\n    base_branch: main\n');
  put('.specs-inferno/config.yaml', `delivery:\n  base_branch: main\nworktree:\n  bootstrap:\n${config.map((c) => `    - ${c}\n`).join('')}`);
  put('unrelated.txt', 'first\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  return { root, dir, git, put };
}

test('a failed bootstrap resumes at the phase that failed and keeps the edits made since', (t) => {
  const { root, dir, put } = fixture(t, ['first', 'second']);
  intents.claim('a', { cwd: root });
  let fail = true;
  const calls = [];
  const runShell = (command, tree, log) => {
    calls.push(command);
    return { command, code: command === 'second' && fail ? 1 : 0, log, seconds: 0 };
  };
  const target = path.join(dir, 'tree');
  const first = intents.worktree('a', { cwd: root, path: target, runShell });
  assert.equal(first.exit, 2);
  assert.equal(first.payload.bootstrap, 'failed');

  writeFile(path.join(target, 'unrelated.txt'), 'keep user edits');
  fail = false;
  const retry = intents.worktree('a', { cwd: root, runShell });
  assert.equal(retry.exit, 0, retry.out.join('\n'));
  assert.equal(retry.payload.created, false);
  assert.equal(retry.payload.bootstrap, 'complete');
  assert.deepEqual(calls, ['first', 'second', 'second']);
  assert.equal(fs.readFileSync(path.join(target, 'unrelated.txt'), 'utf8'), 'keep user edits');

  assert.equal(intents.worktree('a', { cwd: root, runShell }).exit, 0);
  assert.deepEqual(calls, ['first', 'second', 'second'], 'a completed bootstrap is not run again');

  put('.specs-inferno/config.yaml', 'delivery:\n  base_branch: main\nworktree:\n  bootstrap:\n    - first\n    - changed\n');
  assert.equal(intents.worktree('a', { cwd: root, runShell }).exit, 0);
  assert.deepEqual(calls, ['first', 'second', 'second', 'changed'], 'a changed phase reruns from that phase');
});

test('a changed dependency file invalidates the completed bootstrap phases', (t) => {
  const { root, dir, put, git } = fixture(t, ['harmless-setup']);
  put('package-lock.json', '{"version":1}');
  git('add', '.');
  git('commit', '-qm', 'lockfile');
  intents.claim('a', { cwd: root });
  let calls = 0;
  const runShell = (command, tree, log) => {
    calls += 1;
    return { command, code: 0, seconds: 0, log };
  };
  const first = intents.worktree('a', { cwd: root, path: path.join(dir, 'tree'), runShell });
  assert.equal(first.exit, 0);
  assert.equal(intents.worktree('a', { cwd: root, runShell }).exit, 0);
  assert.equal(calls, 1);
  writeFile(path.join(first.payload.path, 'package-lock.json'), '{"version":2}');
  assert.equal(intents.worktree('a', { cwd: root, runShell }).exit, 0);
  assert.equal(calls, 2);
});

/** A runner whose `dirty` phase rewrites a tracked file and whose `breaks` phase fails while `fail.on`. */
function dirtying(target, fail) {
  const calls = [];
  const runShell = (command, tree, log) => {
    calls.push(command);
    if (command === 'dirty') writeFile(path.join(tree, 'unrelated.txt'), 'rewritten by the bootstrap\n');
    return { command, code: command === 'breaks' && fail.on ? 1 : 0, log, seconds: 0 };
  };
  return { calls, runShell };
}

test('a bootstrap that dirtied the tree stays failed on a plain retry until its change is dealt with', (t) => {
  const { root, dir } = fixture(t, ['dirty']);
  intents.claim('a', { cwd: root });
  const target = path.join(dir, 'tree');
  const { calls, runShell } = dirtying(target, { on: false });
  const first = intents.worktree('a', { cwd: root, path: target, runShell });
  assert.equal(first.exit, 2);
  assert.deepEqual(first.payload.dirty, ['unrelated.txt']);
  const retry = intents.worktree('a', { cwd: root, runShell });
  assert.equal(retry.exit, 2);
  assert.deepEqual(retry.payload.dirty, ['unrelated.txt']);
  assert.deepEqual(calls, ['dirty'], 'a plain retry reruns no phase');
  execFileSync('git', ['checkout', '--', 'unrelated.txt'], { cwd: target });
  assert.equal(intents.worktree('a', { cwd: root, runShell }).exit, 0);
});

test('a phase that dirtied the tree before a later phase failed is still the bootstrap\'s change on retry', (t) => {
  const { root, dir } = fixture(t, ['dirty', 'breaks']);
  intents.claim('a', { cwd: root });
  const target = path.join(dir, 'tree');
  const fail = { on: true };
  const { calls, runShell } = dirtying(target, fail);
  assert.equal(intents.worktree('a', { cwd: root, path: target, runShell }).exit, 2);
  fail.on = false;
  const retry = intents.worktree('a', { cwd: root, runShell });
  assert.equal(retry.exit, 2);
  assert.deepEqual(retry.payload.dirty, ['unrelated.txt']);
  assert.deepEqual(calls, ['dirty', 'breaks', 'breaks']);
  execFileSync('git', ['checkout', '--', 'unrelated.txt'], { cwd: target });
  assert.equal(intents.worktree('a', { cwd: root, runShell }).exit, 0);
});

test('a claim on a branch with no run stamp still opens and resumes its worktree', (t) => {
  const { root, dir } = fixture(t, ['first']);
  intents.claim('a', { cwd: root, run: 'inferno-intent/a-custom' });
  const runShell = (command, tree, log) => ({ command, code: 0, log, seconds: 0 });
  const first = intents.worktree('a', { cwd: root, path: path.join(dir, 'tree'), runShell });
  assert.equal(first.exit, 0, first.out.join('\n'));
  const again = intents.worktree('a', { cwd: root, runShell });
  assert.equal(again.exit, 0, again.out.join('\n'));
  assert.equal(again.payload.path, first.payload.path);
});
