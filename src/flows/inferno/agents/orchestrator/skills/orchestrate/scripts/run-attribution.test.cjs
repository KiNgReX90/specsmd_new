'use strict';

// verify-item against dispatch records, driven through run.cjs the way the orchestrator does.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const RUN = path.join(__dirname, 'run.cjs');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(root, file, value) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), value);
}

function spec(id, editable, check) {
  return `---\nid: ${id}\nintent: alpha\nstatus: pending\n---\n\n## Execution Manifest\n\nownership:\n  editable:\n` +
    `${editable.map((entry) => `    - ${entry}`).join('\n')}\n${check ? `finalize_check: ${check}\n` : ''}\n## Technical Notes\n\nFixture.\n`;
}

/** A repository with intent alpha and the items given as id -> editable list (or { editable, check }). */
function fixture(t, items) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-attribution-'));
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
  const cache = path.join(directory, 'cache');
  function call(...args) {
    const result = spawnSync(process.execPath, [RUN, ...args, '--json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: cache },
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
  return { root, cache, call, human, start, accept, accepted, verify, write: (file, value) => write(root, file, value), git: (...args) => git(root, ...args) };
}

test('verify-item passes the item check and fails with the log tail', (t) => {
  const f = fixture(t, { a: { editable: ['a.cjs'], check: 'node -e "console.log(require(\'./a.cjs\') === 2 ? 0 : \'the reason\'); process.exit(require(\'./a.cjs\') === 2 ? 0 : 1)"' } });
  f.accepted(f.start('--item', 'a'), []);
  const red = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(red.code, 2, red.out);
  assert.match(red.out, /FAIL[\s\S]*the reason/);
  const fix = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(fix, ['a.cjs']);
  const green = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(green.code, 0, green.out);
  assert.match(green.out, /PASS[\s\S]*ownership clean since [0-9a-f]{40}/);
});

test('verify-item names a changed file outside the ownership and ignores one committed before the dispatch', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  f.write('other.cjs', 'landed first\n');
  f.git('commit', '-qam', 'another item landed');
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, ['a.cjs']);
  assert.deepEqual(f.verify('a').data.outside, []);
  f.write('b.cjs', 'escaped\n');
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['b.cjs']);
});

test('a batch dispatched item by item is reviewed as one, each item against its own dispatch', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  f.accepted(two, ['b.cjs']);
  const batch = f.verify('--items', 'a,b');
  assert.equal(batch.code, 0, batch.out);
  assert.deepEqual(batch.data.outside, []);
});

test('a serial chain that shares a file takes one dispatch-log and passes as one unit', (t) => {
  const f = fixture(t, { a: ['shared.cjs', 'a.cjs'], b: ['shared.cjs', 'b.cjs'] });
  const chain = f.start('--items', 'a,b');
  for (const file of ['shared.cjs', 'a.cjs', 'b.cjs']) f.write(file, 'module.exports = 2;\n');
  f.accepted(chain, ['shared.cjs', 'a.cjs', 'b.cjs']);
  const result = f.verify('--items', 'a,b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
  assert.equal(f.verify('b').code, 0);
});

test('two dispatches that both report a shared file are refused with the chain form named', (t) => {
  const f = fixture(t, { a: ['shared.cjs', 'a.cjs'], b: ['shared.cjs', 'b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  for (const file of ['shared.cjs', 'a.cjs', 'b.cjs']) f.write(file, 'module.exports = 2;\n');
  f.accepted(one, ['shared.cjs', 'a.cjs']);
  f.accepted(two, ['shared.cjs', 'b.cjs']);
  const result = f.verify('--items', 'a,b');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /overlaps at shared\.cjs[\s\S]*--items/);
});

test('a partial correction is judged on the files it changed and the first attempt keeps its own', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'a.test.cjs'] });
  const first = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('a.test.cjs', 'test\n');
  f.accepted(first, ['a.cjs', 'a.test.cjs']);
  const fix = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 3;\n');
  f.accepted(fix, ['a.cjs', 'a.test.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].changed, ['a.cjs', 'a.test.cjs']);
  const again = f.start('--item', 'a');
  const refused = f.accept(again, ['b.cjs']);
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, /no dispatch patch: b\.cjs/);
});

test('a correction cannot launder an escape its first attempt made', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const first = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('other.cjs', 'escaped\n');
  f.accepted(first, ['a.cjs']);
  assert.deepEqual(f.verify('a').data.outside, ['other.cjs']);
  const fix = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 3;\n');
  f.accepted(fix, ['a.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['other.cjs']);
});

test('an edit after acceptance names the correction baseline it needed', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const first = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(first, ['a.cjs']);
  f.write('a.cjs', 'module.exports = 3;\n');
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /bytes changed at a\.cjs[\s\S]*dispatch-log before a correction/);
});

test('an owned file left out of changed_files is reported as unreported, not as outside', (t) => {
  const f = fixture(t, { a: ['src/'] });
  f.write('src/old.cjs', 'old\n');
  f.git('add', '-A');
  f.git('commit', '-qm', 'old');
  const dispatch = f.start('--item', 'a');
  f.write('src/a.cjs', 'module.exports = 2;\n');
  f.git('mv', 'src/old.cjs', 'src/new.cjs');
  f.accepted(dispatch, ['src/a.cjs', 'src/new.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
  assert.deepEqual(result.data.unreported, ['src/old.cjs']);
  assert.match(f.human('verify-item', 'a', '--tree', f.root).out, /not in changed_files: src\/old\.cjs/);
});

test('a second accept-dispatch with another list is refused and names the frozen one', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'b.cjs'] });
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, ['a.cjs']);
  f.accepted(dispatch, ['a.cjs']);
  const result = f.accept(dispatch, ['a.cjs', 'b.cjs']);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /already accepted with a\.cjs/);
});

test('accept-dispatch for an unknown id names the tree it looked in', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const result = f.accept('no-such-dispatch', []);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /no dispatch no-such-dispatch recorded for .*--tree/);
});

test('verify-item waits for every open dispatch of the round to be accepted', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  const waiting = f.verify('a');
  assert.equal(waiting.code, 2, waiting.out);
  assert.match(waiting.out, new RegExp(`dispatch ${two} for b is still open[\\s\\S]*accept-dispatch`));
  f.accepted(two, ['b.cjs']);
  assert.equal(f.verify('a').code, 0);
});

test('a sibling verified after an earlier item landed with a fold does not see the landing as its own', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  f.accepted(two, ['b.cjs']);
  f.write('other.cjs', 'folded from the base\n');
  f.git('add', 'a.cjs', 'other.cjs');
  f.git('commit', '-qm', 'a integrated with the base folded in');
  const result = f.verify('b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
});

test('ownership is checked against the dispatch record, so a widened spec does not cover an escape', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const dispatch = f.start('--item', 'a');
  f.write('.specs-inferno/intents/alpha/work-items/a.md', spec('a', ['a.cjs', 'other.cjs']));
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('other.cjs', 'escaped\n');
  f.accepted(dispatch, ['a.cjs', 'other.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['other.cjs']);
});

test('an item dispatched by the runner before signed records is checked the old way', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const log = path.join(f.cache, 'specsmd-inferno', 'repo', 'dispatch', 'alpha.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, ['earlier', 'alpha', 'a', 'strong', 'builder', ''].join('\t') + '\n');
  f.write('a.cjs', 'module.exports = 2;\n');
  const old = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(old.code, 0, old.out);
  assert.match(old.out, /no signed dispatch for a[\s\S]*ownership clean since HEAD/);
  const refused = f.verify('b');
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, /DISPATCH_PROOF.*no dispatch recorded for b.*dispatch-log/);
});

test('--since reports an untracked symlink leaving the tree as outside instead of crashing', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  fs.symlinkSync(os.tmpdir(), path.join(f.root, 'node_modules'));
  f.write('a.cjs', 'module.exports = 2;\n');
  const result = f.verify('a', '--since', 'HEAD');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['node_modules']);
  const dispatched = fixture(t, { a: ['a.cjs'] });
  fs.symlinkSync(os.tmpdir(), path.join(dispatched.root, 'node_modules'));
  const dispatch = dispatched.start('--item', 'a');
  dispatched.write('a.cjs', 'module.exports = 2;\n');
  dispatched.accepted(dispatch, ['a.cjs']);
  assert.equal(dispatched.verify('a').code, 0);
});
