'use strict';

// verify-item between siblings: which dispatch's accepted patches explain a changed path.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');

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

test('a sibling verified after an earlier item landed and the base was folded in sees neither as its own', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  f.accepted(two, ['b.cjs']);
  f.land('a.cjs');
  f.moveBase('other.cjs', 'moved on the base\n');
  f.git('merge', '-q', '--no-edit', 'main');
  const result = f.verify('b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
  const fast = fixture(t, { a: ['a.cjs'] });
  const dispatch = fast.start('--item', 'a');
  fast.write('a.cjs', 'module.exports = 2;\n');
  fast.accepted(dispatch, ['a.cjs']);
  fast.moveBase('other.cjs', 'moved on the base\n');
  fast.git('merge', '-q', '--ff-only', 'main');
  assert.deepEqual(fast.verify('a').data.outside, []);
});

test('an escape into a sibling\'s ownership that nobody reported is named after the sibling lands', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'a2.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.write('a2.cjs', 'written by the builder of b\n');
  f.accepted(one, ['a.cjs']);
  f.accepted(two, ['b.cjs']);
  assert.deepEqual(f.verify('a').data.unreported, ['a2.cjs']);
  f.land('a.cjs', 'a2.cjs');
  const result = f.verify('b');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['a2.cjs']);
});

test('a later round is waited for, and its patches on top of a landed sibling are not the earlier item\'s', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'], c: ['a.cjs', 'c.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  f.accepted(two, ['b.cjs']);
  f.land('a.cjs');
  const later = f.start('--item', 'c');
  f.write('a.cjs', 'module.exports = 3;\n');
  f.write('c.cjs', 'module.exports = 3;\n');
  assert.match(f.verify('b').out, new RegExp(`dispatch ${later} for c is still open`));
  f.accepted(later, ['a.cjs', 'c.cjs']);
  assert.deepEqual(f.verify('b').data.outside, []);
  f.land('a.cjs', 'c.cjs');
  const result = f.verify('b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
});

test('a correction that removes a file its first attempt added does not stop a sibling\'s review', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'tmp/'], b: ['b.cjs'] });
  const first = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(two, ['b.cjs']);
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('tmp/x.cjs', 'left over\n');
  f.accepted(first, ['a.cjs', 'tmp/x.cjs']);
  const fix = f.start('--item', 'a');
  fs.rmSync(path.join(f.root, 'tmp'), { recursive: true });
  f.accepted(fix, ['tmp/x.cjs']);
  const result = f.verify('b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
});

test('a peer\'s correction on top of an escape into its file does not explain the escape', (t) => {
  for (const early of [true, false]) {
    const f = fixture(t, { a: ['a.cjs', 'f.cjs'], b: ['b.cjs'] });
    const first = f.start('--item', 'a');
    const two = f.start('--item', 'b');
    f.write('a.cjs', 'module.exports = 2;\n');
    f.write('f.cjs', 'A1\n');
    f.accepted(first, ['a.cjs', 'f.cjs']);
    f.write('b.cjs', 'module.exports = 2;\n');
    f.write('f.cjs', 'A1\nescape by b\n');
    f.accepted(two, ['b.cjs']);
    if (early) assert.deepEqual(f.verify('b').data.outside, ['f.cjs']);
    const fix = f.start('--item', 'a');
    f.write('f.cjs', 'A2\nescape by b\n');
    f.accepted(fix, ['f.cjs']);
    const result = f.verify('b');
    assert.equal(result.code, 2, result.out);
    assert.deepEqual(result.data.outside, ['f.cjs']);
  }
});

test('a peer correction that first touches a file after an escape into it does not explain the escape', (t) => {
  const f = fixture(t, { b: ['b.cjs'], c: ['c.cjs', 'f.cjs'] });
  const two = f.start('--item', 'b');
  const first = f.start('--item', 'c');
  f.write('c.cjs', 'module.exports = 2;\n');
  f.accepted(first, ['c.cjs']);
  f.write('b.cjs', 'module.exports = 2;\n');
  f.write('f.cjs', 'escape by b\n');
  f.accepted(two, ['b.cjs']);
  const fix = f.start('--item', 'c');
  f.write('f.cjs', 'escape by b\nedit by c\n');
  f.accepted(fix, ['f.cjs']);
  const result = f.verify('b');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['f.cjs']);
});

test('a late correction that writes back bytes a later round built on is named outside', (t) => {
  const f = fixture(t, { p: ['p.cjs', 'f.cjs'], b: ['b.cjs'], q: ['q.cjs', 'f.cjs'] });
  const one = f.start('--item', 'p');
  const two = f.start('--item', 'b');
  f.write('p.cjs', 'p\n');
  f.write('f.cjs', 'x\n');
  f.write('b.cjs', 'b\n');
  f.accepted(one, ['p.cjs', 'f.cjs']);
  f.accepted(two, ['b.cjs']);
  f.land('p.cjs', 'f.cjs', 'b.cjs');
  const later = f.start('--item', 'q');
  f.write('q.cjs', 'q\n');
  f.write('f.cjs', 'y\n');
  f.accepted(later, ['q.cjs', 'f.cjs']);
  f.land('q.cjs', 'f.cjs');
  const fix = f.start('--item', 'b');
  f.write('b.cjs', 'b fixed\n');
  f.write('f.cjs', 'x\n');
  f.accepted(fix, ['b.cjs']);
  const result = f.verify('b');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['f.cjs']);
});

test('re-logging an item and accepting its full list clears a sibling\'s review, but never takes in a later escape', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'a2.cjs'], b: ['b.cjs'] });
  const first = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('a2.cjs', 'written by the builder of a\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(first, ['a.cjs']);
  f.accepted(two, ['b.cjs']);
  assert.deepEqual(f.verify('b').data.outside, ['a2.cjs']);
  f.accepted(f.start('--item', 'a'), ['a.cjs', 'a2.cjs']);
  const repaired = f.verify('b');
  assert.equal(repaired.code, 0, repaired.out);
  assert.deepEqual(repaired.data.outside, []);
  const g = fixture(t, { a: ['a.cjs', 'a2.cjs'], b: ['b.cjs'] });
  const one = g.start('--item', 'a');
  const other = g.start('--item', 'b');
  g.write('a.cjs', 'module.exports = 2;\n');
  g.accepted(one, ['a.cjs']);
  g.write('b.cjs', 'module.exports = 2;\n');
  g.write('a2.cjs', 'written by the builder of b\n');
  g.accepted(other, ['b.cjs']);
  g.accepted(g.start('--item', 'a'), ['a.cjs', 'a2.cjs']);
  assert.deepEqual(g.verify('b').data.outside, ['a2.cjs']);
});

test('a late correction that writes a sibling\'s landed file back to the first baseline is named outside', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'f.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'a\n');
  f.write('f.cjs', 'changed by a\n');
  f.write('b.cjs', 'b\n');
  f.accepted(one, ['a.cjs', 'f.cjs']);
  f.accepted(two, ['b.cjs']);
  f.land('a.cjs', 'f.cjs', 'b.cjs');
  const fix = f.start('--item', 'b');
  f.write('b.cjs', 'b fixed\n');
  f.write('f.cjs', 'module.exports = 1;\n');
  f.accepted(fix, ['b.cjs']);
  const result = f.verify('b');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['f.cjs']);
});

test('an only attempt that writes back a file a sibling landed while it was open is named outside', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'f.cjs'], b: ['b.cjs'] });
  const two = f.start('--item', 'b');
  f.moveBase('other.cjs', 'moved on the base\n');
  f.git('merge', '-q', '--no-edit', 'main');
  const one = f.start('--item', 'a');
  f.write('a.cjs', 'a\n');
  f.write('f.cjs', 'changed by a\n');
  f.accepted(one, ['a.cjs', 'f.cjs']);
  f.land('a.cjs', 'f.cjs');
  f.write('b.cjs', 'b\n');
  f.write('f.cjs', 'module.exports = 1;\n');
  f.accepted(two, ['b.cjs']);
  const result = f.verify('b');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['f.cjs']);
});

test('sixteen sibling corrections that toggle a file are read in order, and a write back after them is named', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'f.cjs'], b: ['b.cjs'] });
  const two = f.start('--item', 'b');
  for (let i = 0; i < 16; i += 1) {
    const toggle = f.start('--item', 'a');
    f.write('f.cjs', i % 2 === 0 ? 'toggled\n' : 'module.exports = 1;\n');
    f.accepted(toggle, ['f.cjs']);
  }
  f.write('b.cjs', 'b\n');
  f.write('f.cjs', 'toggled\n');
  f.accepted(two, ['b.cjs']);
  const started = Date.now();
  const result = f.verify('b');
  const took = Date.now() - started;
  assert.ok(took < 2000, `verify-item took ${took} ms`);
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['f.cjs']);
});

test('a correction logged for one item of a chain covers the whole chain', (t) => {
  const f = fixture(t, { a: ['shared.cjs', 'a.cjs'], b: ['shared.cjs', 'b.cjs'] });
  const chain = f.start('--items', 'a,b');
  for (const file of ['shared.cjs', 'a.cjs', 'b.cjs']) f.write(file, 'module.exports = 2;\n');
  f.accepted(chain, ['shared.cjs', 'a.cjs', 'b.cjs']);
  const fix = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 3;\n');
  f.accepted(fix, ['a.cjs']);
  for (const selector of [['a'], ['b'], ['--items', 'a,b']]) {
    const result = f.verify(...selector);
    assert.equal(result.code, 0, result.out);
    assert.deepEqual(result.data.outside, []);
  }
});

test('verify-item waits for a correction of a landed item that started after its own baseline', (t) => {
  const f = fixture(t, { b: ['b.cjs'], c: ['c.cjs'] });
  const two = f.start('--item', 'b');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(two, ['b.cjs']);
  f.land('b.cjs');
  const later = f.start('--item', 'c');
  f.write('c.cjs', 'module.exports = 2;\n');
  f.accepted(later, ['c.cjs']);
  const fix = f.start('--item', 'b');
  const result = f.verify('c');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, new RegExp(`dispatch ${fix} for b is still open`));
});

test('a file nobody claims that is written and put back before the review is no change', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const two = f.start('--item', 'b');
  const one = f.start('--item', 'a');
  f.write('other.cjs', 'scratch of the builder of b\n');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  f.write('other.cjs', 'other\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(two, ['b.cjs']);
  const result = f.verify('b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
});

test('an attempt nobody accepted claims what its successor carried only until that successor started', (t) => {
  const f = fixture(t, { a: ['a.cjs', 'a.test.cjs'], b: ['b.cjs'] });
  const two = f.start('--item', 'b');
  f.start('--item', 'a');
  f.write('a.test.cjs', 'written before the builder stopped\n');
  const retry = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(retry, ['a.cjs', 'a.test.cjs']);
  f.write('b.cjs', 'module.exports = 2;\n');
  f.write('a.test.cjs', 'written by the builder of b\n');
  f.accepted(two, ['b.cjs']);
  const result = f.verify('b');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['a.test.cjs']);
});
