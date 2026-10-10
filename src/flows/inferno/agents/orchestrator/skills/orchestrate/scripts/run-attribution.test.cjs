'use strict';

// verify-item against dispatch records, driven through run.cjs the way the orchestrator does.
// A sibling's patches and how they are told apart: run-attribution-peers.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { fixture, spec, write } = require('./run-attribution-fixture.cjs');
const { writeFile } = require('./test-write.cjs');

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
  assert.match(f.human('verify-item', 'a', '--tree', f.root).out,
    /not in changed_files: src\/old\.cjs\. If this item wrote them, run dispatch-log for it again and accept-dispatch its full list/);
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

test('a builder that commits its own escape still has it named outside', (t) => {
  for (const whole of [true, false]) {
    const f = fixture(t, { a: ['a.cjs'] });
    const dispatch = f.start('--item', 'a');
    f.write('a.cjs', 'module.exports = 2;\n');
    f.write('other.cjs', 'escaped\n');
    if (whole) f.git('commit', '-qam', 'the builder commits');
    else f.land('other.cjs');
    f.accepted(dispatch, ['a.cjs']);
    const result = f.verify('a');
    assert.equal(result.code, 2, result.out);
    assert.deepEqual(result.data.outside, ['other.cjs']);
  }
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
  writeFile(log, ['earlier', 'alpha', 'a', 'strong', 'builder', ''].join('\t') + '\n');
  f.write('a.cjs', 'module.exports = 2;\n');
  const old = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(old.code, 0, old.out);
  assert.match(old.out, /no signed dispatch for a[\s\S]*ownership clean since HEAD/);
  const refused = f.verify('b');
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, /DISPATCH_PROOF.*no dispatch recorded for b.*dispatch-log/);
});

test('a dispatch this runner logged is refused, never checked the old way, when its record is missing', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const tree = path.join(path.dirname(f.root), 'wt');
  f.git('worktree', 'add', '-q', '-b', 'wt', tree);
  assert.equal(f.call('dispatch-log', 'alpha', '--item', 'a', '--tier', 'strong', '--agent', 'builder').code, 0);
  write(tree, '.specs-inferno/intents/alpha/work-items/a.md', spec('a', ['a.cjs', 'other.cjs']));
  write(tree, 'a.cjs', 'module.exports = 2;\n');
  write(tree, 'other.cjs', 'escaped\n');
  const elsewhere = f.call('verify-item', 'a', '--tree', tree);
  assert.equal(elsewhere.code, 2, elsewhere.out);
  assert.match(elsewhere.out, /DISPATCH_PROOF.*--tree.*cache/);
  const directory = path.join(f.cache, 'specsmd-inferno', 'repo', 'dispatch');
  for (const name of fs.readdirSync(directory)) if (!name.endsWith('.log')) fs.rmSync(path.join(directory, name), { recursive: true });
  const cleared = f.verify('a');
  assert.equal(cleared.code, 2, cleared.out);
  assert.match(cleared.out, /DISPATCH_PROOF.*--tree.*cache/);
});

test('a re-dispatch after an attempt nobody accepted carries that attempt\'s files', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'a.test.cjs'] });
  f.start('--item', 'a');
  f.write('a.test.cjs', 'written before the builder stopped\n');
  const retry = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(retry, ['a.cjs', 'a.test.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].changed, ['a.cjs', 'a.test.cjs']);
});

test('verify-item refuses and names a path info/exclude newly hides, unless git ignores it anyway', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  f.write('.gitignore', 'build/\n');
  f.land('.gitignore');
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('src/escaped.cjs', 'hidden\n');
  f.write('build/out.cjs', 'built\n');
  fs.mkdirSync(path.join(f.root, '.git', 'info'), { recursive: true });
  fs.appendFileSync(path.join(f.root, '.git', 'info', 'exclude'), 'build/\nsrc/escaped.cjs\n');
  f.accepted(dispatch, ['a.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /DISPATCH_PROOF.*\.git\/info\/exclude hides src\/escaped\.cjs, new or changed since/);
  assert.doesNotMatch(result.out, /build/);
});

test('a line another worktree adds to the shared info/exclude does not stop this tree\'s review', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const tree = path.join(path.dirname(f.root), 'wt');
  f.git('worktree', 'add', '-q', '-b', 'wt', tree);
  fs.mkdirSync(path.join(tree, 'src'));
  fs.symlinkSync(os.tmpdir(), path.join(tree, 'src', 'node_modules'));
  const dispatch = f.call('dispatch-log', 'alpha', '--item', 'a', '--tier', 'strong', '--agent', 'builder', '--tree', tree).data.dispatch_id;
  write(tree, 'a.cjs', 'module.exports = 2;\n');
  fs.mkdirSync(path.join(f.root, '.git', 'info'), { recursive: true });
  fs.appendFileSync(path.join(f.root, '.git', 'info', 'exclude'), 'src/node_modules\n');
  assert.equal(f.call('accept-dispatch', dispatch, '--changed-paths', '["a.cjs"]', '--tree', tree).code, 0);
  const result = f.call('verify-item', 'a', '--tree', tree);
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
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
