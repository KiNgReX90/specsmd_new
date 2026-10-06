'use strict';
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(root, file, value) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-native-cli-'));
  const root = path.join(directory, 'repo');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Native fixture');
  git(root, 'config', 'user.email', 'native@example.test');
  write(root, 'a.cjs', 'module.exports = 1;\n');
  write(root, 'b.cjs', 'module.exports = 1;\n');
  write(root, 'check.cjs', "require('node:assert/strict').equal(require('./' + process.argv[2] + '.cjs'), 2);\n");
  write(root, '.specs-inferno/config.yaml', 'delivery:\n  base_branch: main\n');
  write(root, '.specs-inferno/state.yaml', 'intents:\n  - id: alpha\n    status: in_progress\n    work_items:\n      - id: a\n        status: pending\n      - id: b\n        status: pending\n');
  for (const id of ['a', 'b']) {
    write(root, `.specs-inferno/intents/alpha/work-items/${id}.md`, `---\nid: ${id}\nintent: alpha\nstatus: pending\n---\n\n## Execution Manifest\n\nownership:\n  editable:\n    - ${id}.cjs\nfinalize_check: node check.cjs ${id}\n\n## Technical Notes\n\nNative fixture.\n`);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'native fixture');
  function call(...args) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'run.cjs'), ...args, '--json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: path.join(directory, 'cache') },
    });
    let data;
    try { data = JSON.parse(result.stdout); } catch { data = null; }
    return { code: result.status, data, output: result.stdout + result.stderr };
  }
  function pass(...args) {
    const result = call(...args);
    assert.equal(result.code, 0, result.output);
    return result.data;
  }
  function start(item) {
    return pass('dispatch-log', 'alpha', '--item', item, '--tier', 'strong', '--agent', 'native-builder').dispatch_id;
  }
  function accept(dispatch, item) {
    return pass('accept-dispatch', dispatch, '--changed-paths', JSON.stringify([`${item}.cjs`]));
  }
  return { root, call, pass, start, accept };
}

test('the CLI isolates sibling changes and accepts a corrected attempt without builder commits', (t) => {
  const f = fixture(t);
  const before = git(f.root, 'rev-parse', 'HEAD');
  const a = f.start('a');
  const b = f.start('b');
  write(f.root, 'a.cjs', 'module.exports = 0;\n');
  write(f.root, 'b.cjs', 'module.exports = 2;\n');
  f.accept(a, 'a');
  f.accept(b, 'b');
  const failed = f.call('verify-item', 'a', '--intent', 'alpha', '--dispatch-id', a);
  assert.equal(failed.code, 2, failed.output);
  assert.deepEqual(failed.data.outside, []);
  assert.deepEqual(f.pass('verify-item', 'b', '--intent', 'alpha', '--dispatch-id', b).outside, []);

  const correction = f.start('a');
  assert.notEqual(correction, a);
  write(f.root, 'a.cjs', 'module.exports = 2;\n');
  f.accept(correction, 'a');
  assert.deepEqual(f.pass('verify-item', 'a', '--intent', 'alpha', '--dispatch-id', correction).outside, []);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), before);

  write(f.root, 'a.cjs', 'module.exports = 9;\n');
  const stale = f.call('verify-item', 'a', '--intent', 'alpha', '--dispatch-id', correction);
  assert.equal(stale.code, 2, stale.output);
  assert.match(stale.output, /changed|snapshot/i);
});
