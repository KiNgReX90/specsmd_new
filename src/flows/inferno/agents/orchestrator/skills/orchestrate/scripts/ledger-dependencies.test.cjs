const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const lib = require('./run-lib.cjs');
const writer = require('./state-transition.cjs');
const intents = require('./run-intents.cjs');

function fixture(t, form = 'block') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  const list = (key, values, indent) => {
    const pad = ' '.repeat(indent);
    return form === 'inline' || !values.length
      ? `${pad}${key}: [${values.map(v => JSON.stringify(v)).join(', ')}] # list note`
      : `${pad}${key}: # list note\n${values.map(v => `${pad}  - '${v}' # member note`).join('\n')}`;
  };
  let state = 'intents:\n  - id: chain\n    status: pending\n';
  state += list('tester_cases', ['TC-901', 'TC-902'], 4) + '\n    work_items:\n';
  for (let n = 1; n <= 6; n++) {
    state += `      - id: step-${n}\n        kind: config-only\n        status: pending\n`;
    state += list('depends_on', n === 1 ? [] : [`step-${n - 1}`], 8) + '\n';
    const spec = path.join(root, `.specs-inferno/intents/chain/work-items/step-${n}.md`);
    fs.mkdirSync(path.dirname(spec), { recursive: true });
    fs.writeFileSync(spec, `---\nkind: config-only\n---\n\n## Execution Manifest\n\ncontext:\n  required:\n    - path: fixture.txt\n      reason: fixture\nownership:\n  editable:\n    - step-${n}.txt\n`);
  }
  for (const [id, deps] of [['duty', ['chain']], ['clocks', ['chain', 'duty']]]) {
    state += `  - id: ${id}\n    status: pending\n` + list('depends_on_intents', deps, 4);
    state += '\n    # Capture rationale.\n    comment: |\n      Keep this explanation.\n    work_items: []\n';
  }
  const file = path.join(root, '.specs-inferno/state.yaml');
  fs.writeFileSync(file, state);
  fs.writeFileSync(path.join(root, 'fixture.txt'), 'fixture');
  return { root, file };
}

for (const form of ['block', 'inline']) {
  test(`${form} lists preserve the six-item ready frontier and intent claim gates`, t => {
    const { root, file } = fixture(t, form);
    const ledger = lib.readLedger(root);
    assert.deepEqual(ledger.intents[0].tester_cases, ['TC-901', 'TC-902']);
    assert.deepEqual(ledger.intents[1].depends_on_intents, ['chain']);
    for (let n = 1; n <= 6; n++) {
      const frontier = intents.frontier('chain', { tree: root });
      assert.equal(frontier.exit, 0, frontier.out.join('\n'));
      assert.deepEqual(frontier.payload.ready.map(i => i.id), [`step-${n}`]);
      assert.equal(frontier.payload.waiting.length, 6 - n);
      writer.completeItem({ file, intent: 'chain', item: `step-${n}`, proof: 'abc1234' });
    }
    const selected = intents.select({ cwd: root }).payload;
    assert.deepEqual(selected.claimable.map(i => i.id), ['chain']);
    assert.deepEqual(selected.blocked.map(i => i.unmet), [['chain'], ['chain', 'duty']]);
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => writer.claimIntent({ file, intent: 'duty' }), e => e.code === 'DEPENDS_UNMET');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    writer.closeIntent({ file, intent: 'chain' });
    assert.equal(writer.claimIntent({ file, intent: 'duty', run: 'fixture' }).changed, true);
    const archived = writer.archiveIntent({ file, intent: 'chain', now: '2026-09-09T00:00:00Z' });
    assert.deepEqual(archived.freed, [
      { intent: 'duty', freed: ['chain'] }, { intent: 'clocks', freed: ['chain'] },
    ]);
    const remaining = lib.readLedger(root);
    assert.deepEqual(remaining.intents.map(i => i.depends_on_intents), [[], ['duty']]);
    const out = fs.readFileSync(file, 'utf8');
    assert.equal((out.match(/Keep this explanation\./g) || []).length, 2);
    assert.equal((out.match(/Prerequisite chain completed;/g) || []).length, 2);
    assert.match(out, /# list note/);
    if (form === 'block') assert.match(out, /- 'duty' # member note/);
    writer.closeIntent({ file, intent: 'duty' });
    writer.archiveIntent({ file, intent: 'duty' });
    assert.deepEqual(lib.readLedger(root).intents[0].depends_on_intents, []);
    assert.equal(writer.claimIntent({ file, intent: 'clocks' }).changed, true);
    assert.equal(writer.archiveIntent({ file, intent: 'chain' }).changed, false);
  });
}

for (const value of ['not-a-list', '[chain', '[chain,,duty]', '\n      - chain\n      unexpected: duty']) {
  test(`malformed dependency fails closed for reading and writing ${JSON.stringify(value)}`, t => {
    const { root, file } = fixture(t);
    const content = fs.readFileSync(file, 'utf8').replace(
      /depends_on_intents: # list note\n      - 'chain' # member note/,
      `depends_on_intents: ${value}`,
    );
    fs.writeFileSync(file, content);
    assert.throws(() => lib.readLedger(root), e => e.code === 'DEPENDS_FORM');
    assert.throws(() => writer.claimIntent({ file, intent: 'duty' }), e => e.code === 'DEPENDS_FORM');
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  });
}

const { readList, listValues, removeListValues } = require('./state-lists.cjs');
function sequence(content) {
  const lines = ['intents:', '  - id: example', ...content.split('\n'), '    status: pending'];
  const entry = writer.locateIntents(lines)[0];
  return { lines, entry };
}

for (const source of [
  '    depends_on_intents: ["one", \'two\', three,] # header',
  '    depends_on_intents:\n      - one\n      # between\n\n      - "two"\n      - three',
  '    depends_on_intents:\n    - one\n    - two\n    - three',
]) {
  test(`sequence boundaries and removal preserve neighbors ${JSON.stringify(source)}`, () => {
    const { lines, entry } = sequence(source);
    assert.deepEqual(listValues(lines, entry, 'depends_on_intents'), ['one', 'two', 'three']);
    assert.deepEqual(removeListValues(lines, entry, 'depends_on_intents', new Set(['one', 'three'])), ['one', 'three']);
    const updated = writer.locateIntents(lines)[0];
    assert.deepEqual(listValues(lines, updated, 'depends_on_intents'), ['two']);
    assert.equal(writer.statusOf(lines, updated), 'pending');
    const unchanged = [...lines];
    assert.deepEqual(removeListValues(lines, updated, 'depends_on_intents', new Set(['absent'])), []);
    assert.deepEqual(lines, unchanged);
  });
}

test('quoted punctuation remains inside a list member', () => {
  const { lines, entry } = sequence('    depends_on_intents: ["one, two", \'three # four\', "five\\\" # six", \'it\'\'s-seven\'] # outside');
  assert.deepEqual(listValues(lines, entry, 'depends_on_intents'), ['one, two', 'three # four', 'five" # six', "it's-seven"]);
  removeListValues(lines, entry, 'depends_on_intents', new Set(['one, two']));
  assert.match(lines[2], /# outside$/);
  assert.deepEqual(listValues(lines, entry, 'depends_on_intents'), ['three # four', 'five" # six', "it's-seven"]);
});

test('absent and explicit empty lists read as empty', () => {
  for (const source of ['    title: Example', '    depends_on_intents: [] # empty']) {
    const { lines, entry } = sequence(source);
    assert.deepEqual(listValues(lines, entry, 'depends_on_intents'), []);
  }
});

for (const source of ['', 'null', '{}', '[one] garbage', '[""]', '\n      - one\n        - two', '\n      - id: one', '[one]\n      - two']) {
  test(`unsupported list syntax fails explicitly ${JSON.stringify(source)}`, () => {
    const { lines, entry } = sequence(`    depends_on_intents: ${source}`);
    assert.throws(() => readList(lines, entry, 'depends_on_intents'), e => e.code === 'DEPENDS_FORM');
  });
}

test('archive re-locates comment blocks after removing uncommented dependency lines', t => {
  const { root, file } = fixture(t);
  let content = fs.readFileSync(file, 'utf8').replaceAll(' # member note', '');
  content = content.replaceAll('    comment: |\n      Keep this explanation.\n', '');
  fs.writeFileSync(file, content);
  for (let n = 1; n <= 6; n++) writer.completeItem({ file, intent: 'chain', item: `step-${n}`, proof: 'abc1234' });
  writer.closeIntent({ file, intent: 'chain' });
  writer.archiveIntent({ file, intent: 'chain' });
  const out = fs.readFileSync(file, 'utf8');
  assert.equal((out.match(/# Prerequisite chain completed;/g) || []).length, 2);
  assert.deepEqual(lib.readLedger(root).intents.map(i => i.depends_on_intents), [[], ['duty']]);
});

test('archive refuses malformed dependents without changing either ledger', t => {
  const { root, file } = fixture(t);
  for (let n = 1; n <= 6; n++) writer.completeItem({ file, intent: 'chain', item: `step-${n}`, proof: 'abc1234' });
  writer.closeIntent({ file, intent: 'chain' });
  const content = fs.readFileSync(file, 'utf8').replace(
    /depends_on_intents: # list note\n      - 'chain' # member note\n      - 'duty' # member note/,
    'depends_on_intents: invalid',
  );
  fs.writeFileSync(file, content);
  assert.throws(() => writer.archiveIntent({ file, intent: 'chain' }), e => e.code === 'DEPENDS_FORM');
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.equal(fs.existsSync(path.join(root, '.specs-inferno/archive/state.yaml')), false);
});
