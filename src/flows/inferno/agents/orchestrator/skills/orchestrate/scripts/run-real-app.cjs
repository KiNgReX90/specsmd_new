'use strict';

/**
 * `run.cjs real-app`: the helpers and case texts that drive the real app binary, named by
 * `real_app.paths` in the host config, against a diff. No gate runs those journeys inside an
 * agent run, so the review is where a stale one is caught, and the reviewer dispatch carries
 * this call. It prints two kinds of line. A `stale` line is a helper line that still names a
 * test id, label or route the diff took away, and each one is a finding. A `drives` line is a
 * helper file that names a test id or catalogue key declared, at either end of the range, in a
 * source file the range changed, with the first five keys it shares. A shared label never makes
 * a drives line, because one label names many screens. The reviewer reads
 * that file against what the screen now does, because ids that survive say nothing about the
 * behaviour behind them.
 *
 * A source is a code or JSON file up to 1 MB outside the real-app paths and the tests, so prose,
 * docs and large fixtures declare nothing. A key is taken away when a removed line of a source
 * declares it and no source at the range end declares it any more. An id or a
 * label quoted whole in a source, as in a constant map the screen renders, stays. A hit is a
 * line of a real-app file at the range end that names the key, unless the range added that line.
 * With `--item`, only the changes in the paths that item owns count, for both kinds.
 *
 * The declarations it reads, one line at a time:
 * - test ids: `data-testid`, `data-test-id`, `data-test`, `data-cy` and `data-qa` as a quoted
 *   value, a braced literal or ternary branch, or an `[attr.]`, `:` or `v-bind:` binding of one;
 * - labels: `aria-label`, `label`, `alt` and `placeholder` in the same forms, the text of a
 *   one-line label, button, link, legend, summary or heading, and the value of a flat catalogue
 *   entry such as `'runs.dismiss': 'Dismiss'`;
 * - catalogue keys: the key of that entry;
 * - routes: a SvelteKit `routes/**\/+page.*` or Next `app/**\/page.*` file the range deletes or
 *   moves, and `path: 'x'` or `path="x"` in a file named for its routes or kept under `router/`.
 *
 * What it does not catch: an id, label or route built at run time (interpolation, a constant
 * map, `data-testid={action.testid}`), a declaration split over lines, a nested JSON catalogue,
 * a dynamic route segment, a helper that matches by prefix (`[data-testid^="walk"]`) or by a
 * computed string, and a control that left the screen while its catalogue entry stayed. An element
 * whose id survived while its behaviour changed is never stale, which is what `drives` is for. A
 * route key also hits a file path that happens to share its name.
 *
 * Exit codes: 0 no stale line or no key set, 2 stale lines. Zero dependencies, like every script beside it.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

const USAGE = 'usage: node run.cjs real-app --range <from>..<to> [--item <id>] [--tree <dir>] [--config <file>]';

/** A line this long is minified or generated, and declares nothing a person wrote. */
const MAX_LINE = 2000;
/** A changed source past this size is generated, and its keys are no screen's. */
const MAX_BLOB = 1024 * 1024;
/** The keys one drives line shows before it counts the rest. */
const SHOWN_KEYS = 5;
/**
 * What a drives line counts, in the order it shows them. A label is shared by many screens, so it
 * counts only where it is exact, in a stale line.
 */
const KIND_ORDER = { testid: 0, copy: 1 };

const TEST_FILE = /\.(?:test|spec)\.[^/]+$|(?:^|\/)__tests__\//;
/** Where a screen declares what it shows. Prose and docs that quote an id declare nothing. */
const SOURCE = /\.(?:svelte|vue|astro|html?|[cm]?[jt]sx?|json)$/i;
/** A screen source outside the helpers and the tests. */
const screenSource = (file, isRealApp) => SOURCE.test(file) && !isRealApp(file) && !TEST_FILE.test(file);

/** The globs `real_app.paths` names, or none when the key is unset or empty. */
function realAppPaths(config, label) {
  const section = config.real_app;
  if (section === undefined || section === null || section === '') return [];
  const bad = new RunError(
    `real_app in ${label} must be a map whose paths lists globs: "real_app:" then ` +
      '"paths: [\\"integration/lib/**\\"]" indented under it.',
    'BAD_CONFIG'
  );
  if (typeof section !== 'object' || Array.isArray(section)) throw bad;
  if (section.paths === undefined || section.paths === '') return [];
  const list = Array.isArray(section.paths) ? section.paths : [section.paths];
  if (!list.every((glob) => typeof glob === 'string' && glob.trim().length > 0)) throw bad;
  return list;
}

// --- declarations ------------------------------------------------------------

const TEST_ATTRS = 'data-testid|data-test-id|data-test|data-cy|data-qa';
const LABEL_ATTRS = 'aria-label|label|alt|placeholder';

const plainAttr = (names) =>
  new RegExp(`(?<![\\w:.\\-\\[])(?:${names})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([^{}]*)\\})`, 'g');
const boundAttr = (names) =>
  new RegExp(`(?:\\[(?:attr\\.)?(?:${names})\\]|(?<![\\w-])(?:v-bind)?:(?:${names}))\\s*=\\s*"([^"]*)"`, 'g');

/** A literal an expression evaluates to as a whole: alone, or a branch of a ternary. */
const LITERAL = /(?:^|[?:])\s*(['"])([^'"\\{}$]+)\1\s*(?=$|:)/g;
const ELEMENT = /<(label|button|a|legend|summary|h[1-6])\b[^>]*>([^<>{}]+)<\/\1\s*>/gi;
const CATALOGUE = /^\s*(['"])([A-Za-z_$][\w$-]*(?:\.[\w$-]+)+)\1\s*:\s*(.*)$/;
const CATALOGUE_TEXT = /^(['"`])((?:(?!\1)[^\\])*)\1\s*,?\s*(?:\/\/.*)?$/;
const ROUTE_DECL = /(?<![\w-])path\s*[:=]\s*\{?\s*(['"`])([^'"`]*)\1/g;
const SVELTE_PAGE = /(?:^|\/)routes\/((?:[^/]+\/)*)\+page(?:@[^./]*)?\.[A-Za-z]+$/;
const NEXT_PAGE = /(?:^|\/)app\/((?:[^/]+\/)*)page\.(?:jsx?|tsx?|mdx)$/;

function literals(expression) {
  return [...expression.trim().matchAll(LITERAL)].map((match) => match[2]);
}

/** Every literal value of the named attributes on one line, in the order they appear. */
function attributeValues(line, names) {
  const found = [];
  for (const match of line.matchAll(plainAttr(names))) {
    const quoted = match[1] !== undefined ? match[1] : match[2];
    if (quoted !== undefined) {
      if (!quoted.includes('{')) found.push({ at: match.index, values: [quoted] });
    } else found.push({ at: match.index, values: literals(match[3]) });
  }
  for (const match of line.matchAll(boundAttr(names))) found.push({ at: match.index, values: literals(match[1]) });
  return found.sort((left, right) => left.at - right.at).flatMap((entry) => entry.values).map((value) => value.trim()).filter(Boolean);
}

function isRouteFile(file) {
  return /(?:^|[._-])rout(?:e|es|er|ing)(?:[._-]|$)/i.test(path.basename(file)) || /(?:^|\/)router\/[^/]+$/.test(file);
}

/** A route as a test names it, or null for the root, a wildcard or a dynamic segment. */
function routeKey(value) {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed || /[*:[\]$?#]|\s/.test(trimmed)) return null;
  return `/${trimmed}`;
}

/** The route a SvelteKit or Next page file serves, or null when it is no static page. */
function pageRoute(file) {
  const match = SVELTE_PAGE.exec(file) || NEXT_PAGE.exec(file);
  if (!match) return null;
  const segments = match[1].split('/').filter(Boolean).filter((segment) => !/^\(.*\)$/.test(segment));
  if (segments.length === 0 || segments.some((segment) => /[[\]@]/.test(segment) || segment.startsWith('_'))) return null;
  return `/${segments.join('/')}`;
}

/** Every test id, label, catalogue key and route one line of `file` declares. */
function declared(line, file) {
  if (line.length > MAX_LINE) return [];
  const out = [];
  for (const key of attributeValues(line, TEST_ATTRS)) out.push({ kind: 'testid', key });
  for (const key of attributeValues(line, LABEL_ATTRS)) out.push({ kind: 'label', key });
  for (const match of line.matchAll(ELEMENT)) {
    const text = match[2].replace(/\s+/g, ' ').trim();
    if (text) out.push({ kind: 'label', key: text });
  }
  const entry = CATALOGUE.exec(line);
  if (entry) {
    out.push({ kind: 'copy', key: entry[2] });
    const text = CATALOGUE_TEXT.exec(entry[3]);
    if (text && text[2].trim().length > 1 && !/[{$]/.test(text[2])) out.push({ kind: 'label', key: text[2] });
  }
  if (isRouteFile(file)) {
    for (const match of line.matchAll(ROUTE_DECL)) {
      const key = routeKey(match[2]);
      if (key) out.push({ kind: 'route', key });
    }
  }
  return out;
}

// --- naming ------------------------------------------------------------------

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS = new Map();

function pattern(kind, key) {
  const body = escape(key);
  if (kind === 'label') return new RegExp(`["'\`]${body}["'\`]`);
  if (kind === 'copy') return new RegExp(`(?<![\\w.-])${body}(?![\\w-]|\\.[\\w$])`);
  if (kind === 'route') return new RegExp(`${body}(?![\\w-])`);
  return new RegExp(`(?<![\\w-])${body}(?![\\w-])`);
}

/** Whether one helper line names a key: an id at its edges, a label whole in quotes. */
function names(line, { kind, key }) {
  if (!line.includes(key)) return false;
  const at = `${kind}\0${key}`;
  if (!PATTERNS.has(at)) PATTERNS.set(at, pattern(kind, key));
  return PATTERNS.get(at).test(line);
}

const id = (entry) => `${entry.kind}\0${entry.key}`;

const SHOWN = {
  testid: (key) => `testid ${key}`,
  label: (key) => `label "${key}"`,
  copy: (key) => `copy key ${key}`,
  route: (key) => `route ${key}`,
};

// --- git -----------------------------------------------------------------------

function gitRun(tree, args, tolerated = [0]) {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: tree, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (!tolerated.includes(result.status)) {
    throw new RunError(`git ${args.slice(0, 3).join(' ')} failed in ${tree}: ${(result.stderr || '').trim().split('\n')[0]}`, 'GIT');
  }
  return result.stdout || '';
}

const unquote = (file) => (file.startsWith('"') && file.endsWith('"') ? file.slice(1, -1) : file);

/** The range's removed lines per old path, and its added line numbers per new path. */
function diffOf(tree, from, to) {
  const removed = new Map();
  const added = new Map();
  const changed = new Set();
  const out = gitRun(tree, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '--unified=0', '--src-prefix=a/', '--dst-prefix=b/', from, to, '--']);
  let header = false;
  let oldPath = null;
  let newPath = null;
  let next = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('diff --git ')) {
      [header, oldPath, newPath] = [true, null, null];
    } else if (header && line.startsWith('--- ')) {
      oldPath = line === '--- /dev/null' ? null : unquote(line.slice(4)).replace(/^a\//, '');
      if (oldPath) changed.add(oldPath);
    } else if (header && line.startsWith('+++ ')) {
      newPath = line === '+++ /dev/null' ? null : unquote(line.slice(4)).replace(/^b\//, '');
      if (newPath) changed.add(newPath);
    } else if (line.startsWith('@@')) {
      header = false;
      next = Number((/\+(\d+)/.exec(line) || [0, 0])[1]);
    } else if (!header && line.startsWith('-') && oldPath) {
      if (!removed.has(oldPath)) removed.set(oldPath, []);
      removed.get(oldPath).push(line.slice(1));
    } else if (!header && line.startsWith('+') && newPath) {
      if (!added.has(newPath)) added.set(newPath, new Set());
      added.get(newPath).add(next);
      next += 1;
    }
  }
  const deleted = gitRun(tree, ['diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', from, to, '--'])
    .split('\0').filter(Boolean);
  for (const file of deleted) changed.add(file);
  return { removed, added, deleted, changed };
}

/** The text of each `rev:path` that exists, read in one `git cat-file --batch` call. */
function blobs(tree, specs) {
  if (specs.length === 0) return [];
  const result = spawnSync('git', ['cat-file', '--batch'], { cwd: tree, input: `${specs.join('\n')}\n`, maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) throw new RunError(`git cat-file failed in ${tree}`, 'GIT');
  const out = result.stdout;
  const texts = [];
  let offset = 0;
  for (const spec of specs) {
    const newline = out.indexOf(0x0a, offset);
    const header = out.slice(offset, newline).toString('utf8').split(' ');
    offset = newline + 1;
    if (header[1] === 'missing') continue;
    const size = Number(header[2]);
    const body = out.slice(offset, offset + size);
    offset += size + 1;
    if (header[1] === 'blob' && size <= MAX_BLOB && !body.includes(0)) texts.push({ file: spec.slice(spec.indexOf(':') + 1), text: body.toString('utf8') });
  }
  return texts;
}

/**
 * A matcher for many keys at once, linear in the line whatever the count of keys: a line yields
 * the keys one of its tokens, quoted strings or element texts equals, and the few keys no token
 * can hold (a route, a label carrying a quote) by a plain substring test. `names` then confirms.
 */
function finder(entries) {
  const words = new Map();
  const texts = new Map();
  const loose = [];
  const add = (map, entry) => {
    if (!map.has(entry.key)) map.set(entry.key, []);
    map.get(entry.key).push(entry);
  };
  for (const entry of entries) {
    if (entry.kind === 'route' || /["'`<>]/.test(entry.key)) loose.push(entry);
    else add(entry.kind === 'label' ? texts : words, entry);
  }
  const dotted = [...words.keys()].some((key) => key.includes('.'));
  return (line) => {
    const found = new Set();
    const take = (map, key) => {
      for (const entry of map.get(key) || []) found.add(entry);
    };
    if (words.size > 0) {
      for (const token of line.match(/[\w$-]+/g) || []) take(words, token);
      if (dotted && line.includes('.')) for (const token of line.match(/[\w$-]+(?:\.[\w$-]+)+/g) || []) take(words, token);
    }
    if (texts.size > 0 && /["'`]/.test(line)) {
      const parts = line.split(/["'`]/);
      for (let i = 1; i < parts.length - 1; i += 1) take(texts, parts[i]);
    }
    if (texts.size > 0 && line.includes('<')) {
      for (const match of line.matchAll(/>([^<>{}]+)</g)) take(texts, match[1].replace(/\s+/g, ' ').trim());
    }
    for (const entry of loose) if (line.includes(entry.key)) found.add(entry);
    return [...found];
  };
}

/** Every line of every text, numbered from one. */
function* linesOf(texts) {
  for (const { file, text } of texts) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) yield { file, line: i + 1, text: lines[i] };
  }
}

const at = (rev, files) => files.map((file) => `${rev}:${file}`);

// --- the check -----------------------------------------------------------------

function itemPaths(tree, options) {
  const ledger = lib.readLedger(tree);
  const intent = options.intent
    ? lib.findIntent(ledger, options.intent)
    : ledger.intents.find((entry) => entry.items.some((item) => item.id === options.item));
  if (!intent || !intent.items.some((item) => item.id === options.item)) {
    throw new RunError(`work item not found in the live ledger: ${options.item}`, 'ITEM_NOT_FOUND');
  }
  const manifest = lib.readItemSpec(tree, intent.id, options.item).manifest || {};
  return (manifest.ownership && manifest.ownership.editable) || [];
}

function commitOf(tree, ref) {
  const sha = lib.git(tree, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { tolerate: true });
  if (!sha) throw new RunError(`real-app: ${ref} names no commit in ${tree}`, 'BAD_ARGS');
  return sha;
}

/** The keys the range removed and the tree at `to` no longer declares. */
function goneKeys(tree, to, files, diff, isRealApp, counts) {
  const candidates = new Map();
  for (const [file, lines] of diff.removed) {
    if (!counts(file)) continue;
    for (const line of lines) for (const entry of declared(line, file)) candidates.set(id(entry), entry);
  }
  for (const file of diff.deleted) {
    const key = counts(file) && pageRoute(file);
    if (key) candidates.set(id({ kind: 'route', key }), { kind: 'route', key });
  }
  if (candidates.size === 0) return [];

  const live = new Set();
  const source = files.filter((file) => screenSource(file, isRealApp));
  for (const file of source) {
    const key = pageRoute(file);
    if (key) live.add(id({ kind: 'route', key }));
  }
  // An id or a label the screen now takes from a constant or a map is quoted whole in that source.
  const quoted = [...candidates.values()].filter((entry) => entry.kind === 'testid' || entry.kind === 'label')
    .map((entry) => ({ kind: 'label', key: entry.key, stays: id(entry) }));
  const find = finder([...[...candidates.values()].filter((entry) => entry.kind !== 'route'), ...quoted]);
  for (const hit of linesOf(blobs(tree, at(to, source)))) {
    const found = find(hit.text);
    if (found.length === 0 && !(isRouteFile(hit.file) && hit.text.includes('path'))) continue;
    for (const entry of declared(hit.text, hit.file)) live.add(id(entry));
    for (const entry of found) if (entry.stays && names(hit.text, entry)) live.add(entry.stays);
  }
  return [...candidates.values()].filter((entry) => !live.has(id(entry)));
}

/** The helper lines at `to` that name a gone key, minus the lines the range added. */
function staleOf(tree, to, diff, helpers, gone) {
  if (gone.length === 0) return [];
  const find = finder(gone);
  const stale = [];
  for (const hit of linesOf(blobs(tree, at(to, helpers)))) {
    if (diff.added.has(hit.file) && diff.added.get(hit.file).has(hit.line)) continue;
    for (const entry of find(hit.text)) {
      if (names(hit.text, entry)) stale.push({ file: hit.file, line: hit.line, kind: entry.kind, key: entry.key });
    }
  }
  return stale.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.key.localeCompare(right.key));
}

/** Each helper file naming a test id or catalogue key a changed source declares at either end. */
function drivesOf(tree, from, to, diff, helpers, counts) {
  const sources = [...diff.changed].filter(counts);
  const keys = new Map();
  for (const hit of linesOf(blobs(tree, [...at(from, sources), ...at(to, sources)]))) {
    for (const entry of declared(hit.text, hit.file)) if (entry.kind in KIND_ORDER) keys.set(id(entry), entry);
  }
  if (keys.size === 0) return [];
  const find = finder([...keys.values()]);
  const named = new Map();
  for (const hit of linesOf(blobs(tree, at(to, helpers)))) {
    for (const entry of find(hit.text)) {
      if (!names(hit.text, entry)) continue;
      if (!named.has(hit.file)) named.set(hit.file, new Map());
      named.get(hit.file).set(id(entry), entry);
    }
  }
  return [...named].sort(([left], [right]) => left.localeCompare(right)).map(([file, shared]) => ({
    file,
    keys: [...shared.values()].sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.key.localeCompare(right.key)),
  }));
}

function drivesLine({ file, keys }) {
  const shown = keys.slice(0, SHOWN_KEYS).map((entry) => SHOWN[entry.kind](entry.key)).join(', ');
  return `drives ${file} via ${shown}${keys.length > SHOWN_KEYS ? ` and ${keys.length - SHOWN_KEYS} more` : ''}`;
}

function realApp(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const globs = realAppPaths(config, options.config || path.join(lib.SPECS_DIR, 'config.yaml'));
  if (globs.length === 0) return { exit: 0, payload: { ok: true, skipped: true, stale: [], drives: [] }, out: [] };
  if (!options.range) throw new RunError(USAGE, 'BAD_ARGS', 1);
  const [fromRef, toRef] = options.range.includes('..') ? options.range.split(/\.{2,3}/) : [options.range, 'HEAD'];
  const from = commitOf(tree, fromRef);
  const to = commitOf(tree, toRef || 'HEAD');
  const owned = options.item ? itemPaths(tree, options) : null;
  const isRealApp = (file) => lib.matchesAny(file, globs);
  const counts = (file) => screenSource(file, isRealApp) && (!owned || lib.ownedBy(file, owned, tree));

  const diff = diffOf(tree, from, to);
  const listed = gitRun(tree, ['ls-tree', '-r', '-l', '-z', to]).split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    return { file: entry.slice(tab + 1), size: Number(entry.slice(0, tab).trim().split(/\s+/)[3]) || 0 };
  });
  // A blob past the cap is generated or a fixture, so it is never read.
  const files = listed.filter((entry) => entry.size <= MAX_BLOB).map((entry) => entry.file);
  const helpers = files.filter(isRealApp);
  const gone = helpers.length > 0 ? goneKeys(tree, to, files, diff, isRealApp, counts) : [];
  const stale = staleOf(tree, to, diff, helpers, gone);
  const drives = helpers.length > 0 ? drivesOf(tree, from, to, diff, helpers, counts) : [];
  return {
    exit: stale.length > 0 ? 2 : 0,
    payload: { ok: stale.length === 0, range: options.range, gone, stale, drives },
    out: [
      ...stale.map((hit) => `stale ${hit.file}:${hit.line} names ${SHOWN[hit.kind](hit.key)} that the diff removed`),
      ...drives.map(drivesLine),
    ],
  };
}

module.exports = { USAGE, declared, names, pageRoute, realApp, realAppPaths };
