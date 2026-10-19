'use strict';

/**
 * `run.cjs cases --range <from>..<to>`: the tester cases a range changes the truth of, refused at
 * every landing until each is edited or answered. The cases drifted from main while every rule
 * about them was text (43 of 342 cases and hand checks stale on 2026-10-19), so a sweep reported
 * defects that were not there.
 *
 * Three rules over the range, printed together, exit 2 on any:
 * 1. stale: a case at the range end names a label a removed source line declared and no source
 *    declares any more. Only an edit of the case answers it.
 * 2. unanswered: a case the range reaches, neither edited in the range nor named on a `Cases:`
 *    line of one of its commits. A case is reached when a changed `test(` block of a proving test
 *    names its id, when its text names a label a changed source line declares, or when a test id,
 *    id prefix or catalogue key a changed source line declares is named in a proving test's block
 *    that names its id. A key named outside every block reaches every id in that file.
 * 3. expectations: the range modified or deleted lines of a test that existed at its start, edited
 *    no case, and no commit carries a `Cases:` line. `Cases: none` answers this rule only.
 * With `proves`, the gate adds: each id the brief's `Tester proves:` line names is edited or named.
 *
 * Config `cases:` (absent: no-op): `files` (path, `case` opener regex with the id in group 1, and
 * `rules: [stale]` for a file that joins rule 1 only), `tests`, `sources`, `expectations` (globs).
 * Labels and keys are read by run-real-app-keys.cjs, the text shapes by run-cases-blocks.cjs.
 * Zero dependencies, like every script beside it.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { declared, finder, names } = require('./run-real-app-keys.cjs');
const realApp = require('./run-real-app.cjs');
const { blockAt, caseBlocks, labelPattern, namesId, testBlocks, trailers } = require('./run-cases-blocks.cjs');

const { RunError } = lib;

const USAGE = 'usage: node run.cjs cases --range <from>..<to> [--tree <dir>] [--config <file>]';
/** The changed test titles a refusal shows before it counts the rest. */
const SHOWN_TITLES = 8;
const KEY_KINDS = new Set(['testid', 'prefix', 'copy']);
/** The most cases one key may reach before it counts as a shared step that reaches none. */
const MAX_DRIVEN = 3;

const globs = (value) => (value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value]);

/** The validated `cases:` section, or null when the host configures none. */
function casesConfig(config, label) {
  const section = config.cases;
  if (section === undefined || section === null || section === '') return null;
  const bad = (what) => new RunError(
    `cases in ${label} ${what}: "cases:" then "files:" listing "- path: integration/TEST-CASES.md" with ` +
      '"case: \'^### (TC-\\d+)\'" under it, and "tests", "sources" and "expectations" as glob lists.',
    'BAD_CONFIG'
  );
  if (typeof section !== 'object' || Array.isArray(section)) throw bad('must be a map');
  const files = globs(section.files);
  if (files.length === 0) throw bad('lists no files');
  const parsed = files.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || typeof entry.case !== 'string') {
      throw bad('needs a path and a case opener on every file');
    }
    let opener;
    try {
      opener = new RegExp(entry.case);
    } catch (error) {
      throw bad(`has a case opener that is no regex: ${entry.case}`);
    }
    const rules = globs(entry.rules);
    if (rules.some((rule) => rule !== 'stale')) throw bad('names a rule other than stale');
    return { path: entry.path, opener, staleOnly: rules.length > 0 };
  });
  const lists = {};
  for (const key of ['tests', 'sources', 'expectations']) {
    lists[key] = globs(section[key]);
    if (!lists[key].every((glob) => typeof glob === 'string' && glob.trim())) throw bad(`has a ${key} entry that is no glob`);
  }
  return { files: parsed, ...lists };
}

function commitOf(tree, ref) {
  const sha = lib.git(tree, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { tolerate: true });
  if (!sha) throw new RunError(`cases: ${ref} names no commit in ${tree}`, 'BAD_ARGS');
  return sha;
}

/** The text of each file at `rev`, by path. */
function textsAt(tree, rev, files) {
  const specs = files.map((file) => `${rev}:${file}`);
  return new Map(realApp.blobs(tree, specs).map(({ file, text }) => [file, text]));
}

/** The lines the range changed in `file`, as old-side and new-side line numbers. */
const changedLines = (diff, file) => ({ old: diff.removedAt.get(file) || new Set(), now: diff.added.get(file) || new Set() });

function caseState(tree, from, to, settings, diff) {
  const paths = settings.files.map((entry) => entry.path);
  const before = textsAt(tree, from, paths);
  const after = textsAt(tree, to, paths);
  const files = settings.files.map((entry) => {
    const old = caseBlocks(before.get(entry.path) || '', entry.opener);
    const now = caseBlocks(after.get(entry.path) || '', entry.opener);
    const lines = changedLines(diff, entry.path);
    const edited = new Set([
      ...old.filter((block) => [...lines.old].some((line) => block.start <= line && line <= block.end)),
      ...now.filter((block) => [...lines.now].some((line) => block.start <= line && line <= block.end)),
    ].map((block) => block.id));
    return { ...entry, old, now, edited };
  });
  const full = files.filter((entry) => !entry.staleOnly);
  const ids = new Set(full.flatMap((entry) => [...entry.old, ...entry.now].map((block) => block.id)));
  const edited = new Set(full.flatMap((entry) => [...entry.edited]));
  return { files, full, ids, edited };
}

/** Rule 1: every case at the range end naming a label the range took away. */
function staleCases(state, gone) {
  const labels = gone.filter((entry) => entry.kind === 'label').map((entry) => ({ key: entry.key, pattern: labelPattern(entry.key) }))
    .filter((entry) => entry.pattern);
  const stale = [];
  for (const file of state.files) {
    for (const block of file.now) {
      for (const label of labels) if (label.pattern.test(block.text)) stale.push({ case: block.id, file: file.path, key: label.key });
    }
  }
  return stale;
}

/** Rule 2: each case the range reaches, with the first reason it was reached. */
function reachedCases(tree, from, to, settings, diff, state, isSource) {
  const reached = new Map();
  const reach = (id, why) => {
    if (state.ids.has(id) && !reached.has(id)) reached.set(id, why);
  };
  const idsIn = (text) => [...state.ids].filter((id) => namesId(text, id));
  const proving = [...diff.changed].filter((file) => lib.matchesAny(file, settings.tests));
  const before = textsAt(tree, from, proving);
  const after = textsAt(tree, to, proving);
  for (const file of proving) {
    const lines = changedLines(diff, file);
    for (const [text, changed] of [[before.get(file), lines.old], [after.get(file), lines.now]]) {
      if (!text) continue;
      const rows = text.split('\n');
      for (const block of testBlocks(text)) {
        if (![...changed].some((line) => block.start <= line && line <= block.end)) continue;
        for (const id of idsIn(rows.slice(block.start - 1, block.end).join('\n'))) reach(id, `its test block in ${file} changed`);
      }
    }
  }

  const keys = new Map();
  const labels = new Map();
  for (const [file, lines] of [...diff.removed, ...[...diff.addedText].map(([file, set]) => [file, [...set]])]) {
    if (!isSource(file)) continue;
    for (const line of lines) {
      for (const entry of declared(line, file)) {
        if (KEY_KINDS.has(entry.kind)) keys.set(`${entry.kind}\0${entry.key}`, entry);
        else if (entry.kind === 'label') labels.set(entry.key, labelPattern(entry.key));
      }
    }
  }
  for (const file of state.full) {
    for (const block of file.now) {
      for (const [key, pattern] of labels) if (pattern && pattern.test(block.text)) reach(block.id, `names label "${key}" a changed source line declares`);
    }
  }
  if (keys.size === 0) return reached;
  const find = finder([...keys.values()]);
  const tests = lib.gitLines(tree, ['ls-tree', '-r', '--name-only', to]).filter((file) => lib.matchesAny(file, settings.tests));
  const drivenBy = new Map();
  for (const [file, text] of textsAt(tree, to, tests)) {
    const blocks = testBlocks(text);
    const rows = text.split('\n');
    rows.forEach((row, index) => {
      for (const entry of find(row).filter((hit) => names(row, hit))) {
        const block = blockAt(blocks, index + 1);
        const scope = block ? rows.slice(block.start - 1, block.end).join('\n') : text;
        const at = `${entry.kind}\0${entry.key}`;
        if (!drivenBy.has(at)) drivenBy.set(at, { entry, file, ids: new Set() });
        for (const id of idsIn(scope)) drivenBy.get(at).ids.add(id);
      }
    });
  }
  // A key the tests of many cases drive is a step on the way to them, such as the button that
  // opens a screen, and says nothing about which of them the change alters.
  for (const { entry, file, ids } of drivenBy.values()) {
    if (ids.size > MAX_DRIVEN) continue;
    for (const id of ids) reach(id, `its test in ${file} drives ${entry.kind} ${entry.key} a changed source line declares`);
  }
  return reached;
}

/** Rule 3: the title of each test the range modified or deleted lines in, as it stood at the start. */
function changedExpectations(tree, from, settings, diff) {
  const files = [...diff.removedAt.keys()].filter((file) => lib.matchesAny(file, settings.expectations));
  const texts = textsAt(tree, from, files);
  const out = [];
  for (const file of files.sort()) {
    const blocks = testBlocks(texts.get(file) || '');
    const seen = new Set();
    for (const line of [...diff.removedAt.get(file)].sort((a, b) => a - b)) {
      const block = blockAt(blocks, line);
      const title = block ? block.title : null;
      if (seen.has(title)) continue;
      seen.add(title);
      out.push({ file, title, line });
    }
  }
  // A test's own title first; a file changed only in its shared setup comes after every title.
  const rank = (entry) => (entry.title === null ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file) || a.line - b.line).map(({ file, title }) => ({ file, title }));
}

function cases(options, config) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const host = config || lib.readConfig(tree, options.config);
  const settings = casesConfig(host, options.config || path.join(lib.SPECS_DIR, 'config.yaml'));
  if (!settings) return { exit: 0, payload: { ok: true, skipped: true, stale: [], unanswered: [], expectations: [] }, out: [] };
  if (!options.range) throw new RunError(USAGE, 'BAD_ARGS', 1);
  const [fromRef, toRef] = options.range.includes('..') ? options.range.split(/\.{2,3}/) : [options.range, 'HEAD'];
  const from = commitOf(tree, fromRef);
  const to = commitOf(tree, toRef || 'HEAD');

  const special = (file) => settings.files.some((entry) => entry.path === file) ||
    lib.matchesAny(file, settings.tests) || lib.matchesAny(file, settings.expectations);
  const isSource = (file) => lib.matchesAny(file, settings.sources) && !special(file) && realApp.screenSource(file, () => false);
  const diff = realApp.diffOf(tree, from, to);
  const state = caseState(tree, from, to, settings, diff);
  const listed = lib.gitLines(tree, ['ls-tree', '-r', '--name-only', to]);
  const gone = realApp.goneKeys(tree, to, listed, diff, (file) => !isSource(file), isSource);
  const stale = staleCases(state, gone);
  const answers = trailers(lib.git(tree, ['log', '--format=%B%x00', `${from}..${to}`]).split('\0'));
  const answered = (id) => state.edited.has(id) || answers.ids.has(id);
  const staleIds = new Set(stale.map((entry) => entry.case));
  const reached = reachedCases(tree, from, to, settings, diff, state, isSource);
  // A case the brief names and the branch never wrote is unanswered too, so it is reached whether or not it exists.
  for (const id of options.proves || []) if (!reached.has(id)) reached.set(id, "the brief's Tester proves line names it");
  const fileOf = (id) => (state.full.find((file) => [...file.now, ...file.old].some((block) => block.id === id)) || state.full[0] || {}).path;
  const unanswered = [...reached].filter(([id]) => !answered(id) && !staleIds.has(id)).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, why]) => ({ case: id, file: fileOf(id), why }));
  const expectations = changedExpectations(tree, from, settings, diff);
  const refused = expectations.length > 0 && state.edited.size === 0 && !answers.any;

  const out = [
    ...stale.map((entry) => `stale ${entry.case} in ${entry.file} names label "${entry.key}" that the range removed`),
    ...unanswered.map((entry) => `unanswered ${entry.case} in ${entry.file}: ${entry.why}`),
  ];
  if (refused) {
    out.push('expectations changed while no case was edited or answered:');
    out.push(...expectations.slice(0, SHOWN_TITLES).map((entry) => `  ${entry.file}: ${entry.title === null ? '(its shared setup, outside any test)' : entry.title}`));
    if (expectations.length > SHOWN_TITLES) out.push(`  and ${expectations.length - SHOWN_TITLES} more`);
  }
  if (stale.length > 0) out.push('answer: edit each stale case so it names what the screen shows now; a Cases line never answers one.');
  if (unanswered.length > 0 || refused) {
    out.push('answer: edit each case the change alters, or put a "Cases: <ids>" line on the unpushed commit naming the cases ' +
      `you read that still hold${refused ? ' ("Cases: none" when the change alters no case)' : ''}.`);
  }
  const ok = out.length === 0;
  return { exit: ok ? 0 : 2, payload: { ok, range: options.range, stale, unanswered, expectations, refused }, out };
}

/**
 * The check a landing runs over `range`, with the ids the brief's `Tester proves:` line names when
 * an intent gate passes its brief: null when it holds, else the result whose lines refuse.
 */
function refusal(tree, config, range, brief) {
  if (!config.cases) return null;
  const proves = brief && fs.existsSync(brief) ? testerProves(fs.readFileSync(brief, 'utf8')) : [];
  const result = cases({ tree, range, proves }, config);
  return result.exit === 0 ? null : result;
}

/** The case ids the brief's `Tester proves:` line names, or none. */
function testerProves(text) {
  const line = /^[*_\s-]*Tester proves:?[*_]*\s*(.*)$/im.exec(text || '');
  return line ? line[1].split(/[,\s]+/).map((token) => token.replace(/[^\w-]/g, '')).filter((token) => /\d/.test(token)) : [];
}

module.exports = { USAGE, cases, casesConfig, refusal, testerProves };
