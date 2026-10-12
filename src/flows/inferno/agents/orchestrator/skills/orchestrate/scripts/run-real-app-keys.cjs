'use strict';

/**
 * What one source line declares for the real-app check, and how one helper line names it. Pure
 * functions over text: run-real-app.cjs owns the config, git and the two kinds of line it prints.
 *
 * The declarations it reads, one line at a time:
 * - test ids: `data-testid`, `data-test-id`, `data-test`, `data-cy` and `data-qa` as a quoted
 *   value, a braced literal or ternary branch, or an `[attr.]`, `:` or `v-bind:` binding of one,
 *   and the static prefix of one built at run time (`'fb-kind-' + k`, `tile-{id}`, `row-{{ i }}`),
 *   which names every id a helper spells with it and never makes a stale line;
 * - labels: `aria-label`, `label`, `alt` and `placeholder` in the same forms, the text of a
 *   one-line label, button, link, legend, summary or heading, and the value of a flat catalogue
 *   entry such as `'runs.dismiss': 'Dismiss'`;
 * - catalogue keys: the key of that entry;
 * - routes: a SvelteKit `routes/**\/+page.*` or Next `app/**\/page.*` file the range deletes or
 *   moves, and `path: 'x'` or `path="x"` in a file named for its routes or kept under `router/`.
 *
 * What it does not catch: a label or route built at run time, an id built with no static prefix
 * (a constant map, `data-testid={action.testid}`, `idPrefix() + '-close'`), a declaration split
 * over lines, a nested JSON catalogue,
 * a dynamic route segment, a helper that matches by prefix (`[data-testid^="walk"]`) or by a
 * computed string, and a control that left the screen while its catalogue entry stayed. An element
 * whose id survived while its behaviour changed is never stale, which is what `drives` is for. A
 * route key also hits a file path that happens to share its name.
 */

const path = require('path');

/** A line this long is minified or generated, and declares nothing a person wrote. */
const MAX_LINE = 2000;

// --- declarations ------------------------------------------------------------

const TEST_ATTRS = 'data-testid|data-test-id|data-test|data-cy|data-qa';
const LABEL_ATTRS = 'aria-label|label|alt|placeholder';

const plainAttr = (names) =>
  new RegExp(`(?<![\\w:.\\-\\[])(?:${names})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*(\`[^\`]*\`)\\s*\\}|\\{([^{}]*)\\})`, 'g');
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

/** The static start of a value built at run time: `'tile-' + id`, `` `tile-${id}` ``. */
const PREFIX = /(?:^|[?:])\s*(?:(['"])([^'"\\{}$]*[-_])\1\s*\+|`([^`\\{}$]*[-_])\$\{)/g;
/** The same start in a quoted value that interpolates: `tile-{id}`, `row-{{ i }}`. */
const INTERPOLATED = /^([^{}]*[-_])\{/;

function literals(expression) {
  return [...expression.trim().matchAll(LITERAL)].map((match) => match[2]);
}

function prefixes(expression) {
  return [...expression.trim().matchAll(PREFIX)].map((match) => match[2] || match[3]);
}

/**
 * Every literal value of the named attributes on one line, in the order they appear, and the
 * static prefix of each value the line builds at run time.
 */
function attributeValues(line, names) {
  const found = [];
  const push = (at, values, starts) => found.push({ at, values, starts });
  for (const match of line.matchAll(plainAttr(names))) {
    const quoted = match[1] !== undefined ? match[1] : match[2];
    const expression = match[3] !== undefined ? match[3] : match[4];
    if (quoted === undefined) push(match.index, literals(expression), prefixes(expression));
    else if (!quoted.includes('{')) push(match.index, [quoted], []);
    else push(match.index, [], [(INTERPOLATED.exec(quoted) || [])[1]].filter(Boolean));
  }
  for (const match of line.matchAll(boundAttr(names))) push(match.index, literals(match[1]), prefixes(match[1]));
  found.sort((left, right) => left.at - right.at);
  const clean = (list) => list.map((value) => value.trim()).filter(Boolean);
  return { values: clean(found.flatMap((entry) => entry.values)), starts: clean(found.flatMap((entry) => entry.starts)) };
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
  const ids = attributeValues(line, TEST_ATTRS);
  for (const key of ids.values) out.push({ kind: 'testid', key });
  for (const key of ids.starts) out.push({ kind: 'prefix', key });
  for (const key of attributeValues(line, LABEL_ATTRS).values) out.push({ kind: 'label', key });
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
  if (kind === 'prefix') return new RegExp(`(?<![\\w-])${body}[\\w-]`);
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
  prefix: (key) => `testid ${key}*`,
  route: (key) => `route ${key}`,
};

/**
 * A matcher for many keys at once, linear in the line whatever the count of keys: a line yields
 * the keys one of its tokens, quoted strings or element texts equals, and the few keys no token
 * can hold (a route, a label carrying a quote) by a plain substring test. `names` then confirms.
 */
function finder(entries) {
  const words = new Map();
  const texts = new Map();
  const loose = [];
  const starts = entries.filter((entry) => entry.kind === 'prefix');
  const add = (map, entry) => {
    if (!map.has(entry.key)) map.set(entry.key, []);
    map.get(entry.key).push(entry);
  };
  for (const entry of entries) {
    if (entry.kind === 'prefix') continue;
    if (entry.kind === 'route' || /["'`<>]/.test(entry.key)) loose.push(entry);
    else add(entry.kind === 'label' ? texts : words, entry);
  }
  const dotted = [...words.keys()].some((key) => key.includes('.'));
  return (line) => {
    const found = new Set();
    const take = (map, key) => {
      for (const entry of map.get(key) || []) found.add(entry);
    };
    if (words.size > 0 || starts.length > 0) {
      for (const token of line.match(/[\w$-]+/g) || []) {
        take(words, token);
        for (const entry of starts) if (token.length > entry.key.length && token.startsWith(entry.key)) found.add(entry);
      }
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

module.exports = { SHOWN, declared, finder, id, isRouteFile, names, pageRoute };
