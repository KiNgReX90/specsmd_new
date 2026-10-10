'use strict';

// The repository the verify-item suites drive through run.cjs, the way the orchestrator does.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');

const RUN = path.join(__dirname, 'run.cjs');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(root, file, value) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFile(path.join(root, file), value);
}

function spec(id, editable, check) {
  return `---\nid: ${id}\nintent: alpha\nstatus: pending\n---\n\n## Execution Manifest\n\nownership:\n  editable:\n` +
    `${editable.map((entry) => `    - ${entry}`).join('\n')}\n${check ? `finalize_check: ${check}\n` : ''}\n## Technical Notes\n\nFixture.\n`;
}

/** A repository with intent alpha and the items given as id -> editable list (or { editable, check }). */
function fixture(t, items) {
  const directory = tempDir('inferno-attribution-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  const states = Object.keys(items).map((id) => `      - id: ${id}\n        status: pending\n`).join('');
  write(root, '.specs-inferno/config.yaml', 'delivery:\n  base_branch: main\n');
  write(root, '.specs-inferno/state.yaml', `intents:\n  - id: alpha\n    status: in_progress\n    work_items:\n${states}`);
  for (const [id, entry] of Object.entries(items)) {
    const { editable, check } = Array.isArray(entry) ? { editable: entry } : entry;
    for (const file of editable) if (!file.endsWith('/')) write(root, file, 'module.exports = 1;\n');
    write(root, `.specs-inferno/intents/alpha/work-items/${id}.md`, spec(id, editable, check));
  }
  write(root, 'other.cjs', 'other\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'fixture');
  git(root, 'checkout', '-qb', 'intent');
  const cache = path.join(directory, 'cache');
  function call(...args) {
    const result = spawnSync(process.execPath, [RUN, ...args, '--json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: cache }, timeout: 60000,
    });
    let data = null;
    try { data = JSON.parse(result.stdout); } catch (error) { data = null; }
    return { code: result.status, data, out: result.stdout + result.stderr };
  }
  function human(...args) {
    const result = spawnSync(process.execPath, [RUN, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: cache } });
    return { code: result.status, out: result.stdout + result.stderr };
  }
  function start(...selector) {
    const result = call('dispatch-log', 'alpha', ...selector, '--tier', 'strong', '--agent', 'builder', '--tree', root);
    assert.equal(result.code, 0, result.out);
    return result.data.dispatch_id;
  }
  function accept(dispatch, paths) {
    return call('accept-dispatch', dispatch, '--changed-paths', JSON.stringify(paths), '--tree', root);
  }
  function accepted(dispatch, paths) {
    const result = accept(dispatch, paths);
    assert.equal(result.code, 0, result.out);
  }
  const verify = (...args) => call('verify-item', ...args, '--tree', root);
  function land(...files) {
    git(root, 'add', ...files);
    git(root, 'commit', '-qm', 'an item landed');
  }
  /** Commit on the base branch from a worktree of its own, the way another intent's ship does. */
  function moveBase(file, value) {
    const base = path.join(directory, 'base');
    if (!fs.existsSync(base)) git(root, 'worktree', 'add', '-q', base, 'main');
    write(base, file, value);
    git(base, 'add', file);
    git(base, 'commit', '-qm', 'the base moved');
  }
  return { root, cache, call, human, start, accept, accepted, verify, land, moveBase, write: (file, value) => write(root, file, value), git: (...args) => git(root, ...args) };
}

module.exports = { fixture, git, spec, write };
