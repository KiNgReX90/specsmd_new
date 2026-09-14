'use strict';

/**
 * Ownership closure: the files outside an item's `ownership.editable` that reference what the
 * item owns. Measured 2026-09-06 to 07, planner scope was the largest problem class, 16 of 83.
 * The missed file is usually a test, an allowlist, an e2e spec or a script naming an owned
 * symbol, and it goes red at the gate because the builder was not allowed to touch it. This
 * finds the candidates and the orchestrator grants them at dispatch.
 *
 * Evidence has to be narrow or the list is noise. A first run on a real intent printed 873
 * lines, almost all of them the word `dashboard` and the word `evaluate`, so a basename counts
 * only where it names a module, a symbol counts only as a whole word, a test file lends its
 * name to nothing, and a key hitting more than six files is dropped as generic.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

/** Names too common to be evidence of a reference. */
const GENERIC = new Set([
  'index', 'mod', 'main', 'lib', 'test', 'spec', 'type', 'types', 'util', 'utils',
  'const', 'config', 'setup', 'style', 'styles', 'data', 'item', 'name', 'value', 'state', 'props',
]);
const MIN_KEY_LENGTH = 4;
/** Two git greps per item, so the keys stay a command line rather than a scan of the tree. */
const MAX_KEYS = 80;
const MAX_BYTES = 400 * 1024;
/** Above this a key names a habit of the codebase rather than this item's file. */
const MAX_HITS = 6;
/** What one item can usefully hand an orchestrator in a frontier print. */
const MAX_PER_ITEM = 10;

/** Where a missed owner hides: the unit tests, the e2e specs, the case list, the scripts. */
const SEARCH = [
  ':(glob)src/**/*.test.ts',
  ':(glob)e2e/**',
  ':(glob)integration/**',
  ':(glob)scripts/**',
];

/** A test is reached by its runner, so its own name and symbols name nothing elsewhere. */
const LENDS_NOTHING = /(^|\/)(e2e|integration|scripts)\/|\.(test|spec)\./;

const EXPORTED = /^\s*export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const RUST_PUBLIC = /^\s*pub\s+(?:fn|struct|enum)\s+([A-Za-z_][\w]*)/gm;
const TEST_ID = /data-testid=["']([^"']+)["']/g;

function usable(key) {
  return typeof key === 'string' && key.length >= MIN_KEY_LENGTH && !GENERIC.has(key.toLowerCase());
}

function read(tree, rel) {
  const file = path.join(tree, rel);
  try {
    if (fs.statSync(file).size > MAX_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    return '';
  }
}

/** Every tracked file an ownership entry covers: a file is itself, a directory is its contents. */
function filesOf(tree, entry) {
  let stat = null;
  try {
    stat = fs.statSync(path.join(tree, entry));
  } catch (error) {
    return [];
  }
  if (stat.isDirectory()) return lib.gitLines(tree, ['ls-files', '--', entry], { tolerate: true });
  return [entry];
}

function symbolsOf(body) {
  const found = [];
  for (const pattern of [EXPORTED, RUST_PUBLIC, TEST_ID]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(body);
    while (match) {
      found.push(match[1]);
      match = pattern.exec(body);
    }
  }
  return found.filter(usable);
}

/** A module is referenced by its path or by its filename, never by its name as a word. */
function modulePatterns(file) {
  const base = path.basename(file).split('.')[0];
  if (!usable(base)) return null;
  const extension = path.extname(file);
  const patterns = [`/${base}'`, `/${base}"`, `/${base}.`];
  if (extension) patterns.push(`${base}${extension}`);
  return { base, patterns };
}

function ownedBy(file, editable) {
  return (editable || []).some(
    (entry) => file === entry || file.startsWith(`${entry.replace(/\/+$/, '')}/`)
  );
}

/** Every evidence key of one item: how to grep it, how to confirm it, what it belongs to. */
function keysOfItem(tree, item) {
  const keys = new Map();
  const add = (key, entry) => {
    if (!keys.has(key)) keys.set(key, entry);
  };
  for (const owner of (item.ownership && item.ownership.editable) || []) {
    for (const file of filesOf(tree, owner)) {
      if (LENDS_NOTHING.test(file)) continue;
      const module = modulePatterns(file);
      if (module) add(module.base, { owned: owner, word: false, patterns: module.patterns });
      for (const symbol of symbolsOf(read(tree, file))) {
        add(symbol, { owned: owner, word: true, patterns: [symbol] });
      }
      if (keys.size >= MAX_KEYS) return keys;
    }
  }
  return keys;
}

function wordRegExp(key) {
  return new RegExp(`(?<![A-Za-z0-9_])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
}

/** The same test git grep made, repeated on the body so one hit can be attributed to one key. */
function carries(body, key, entry) {
  if (entry.word) return wordRegExp(key).test(body);
  return entry.patterns.some((pattern) => body.includes(pattern));
}

function grep(tree, patterns, word) {
  const args = ['grep', '-l', '-I', '-F'];
  if (word) args.push('-w');
  for (const pattern of patterns) args.push('-e', pattern);
  args.push('--', ...SEARCH);
  return lib.gitLines(tree, args, { tolerate: true });
}

/** Every hit of every key, keyed by the file that carries it. */
function hitsOf(tree, keys, editable) {
  const flat = [];
  const words = [];
  for (const [key, entry] of keys) {
    if (entry.word) words.push(key);
    else flat.push(...entry.patterns);
  }
  const files = new Set();
  if (flat.length > 0) for (const hit of grep(tree, flat, false)) files.add(hit);
  if (words.length > 0) for (const hit of grep(tree, words, true)) files.add(hit);

  const carried = new Map();
  for (const hit of [...files].sort()) {
    if (ownedBy(hit, editable)) continue;
    const body = read(tree, hit);
    const matched = [...keys].filter(([key, entry]) => carries(body, key, entry)).map(([key]) => key);
    if (matched.length > 0) carried.set(hit, matched);
  }
  return carried;
}

/**
 * Candidates for every item in `items`, with `ownedBy` set when another open item in `open`
 * already holds the hit. A tree without git yields nothing rather than an error, because the
 * frontier still has a graph to print.
 */
function candidates(tree, items, open) {
  const found = [];
  const skipped = [];
  if (!lib.git(tree, ['rev-parse', '--git-dir'], { tolerate: true })) return { found, skipped };

  for (const item of items) {
    const editable = (item.ownership && item.ownership.editable) || [];
    const keys = keysOfItem(tree, item);
    if (keys.size === 0) continue;
    const carried = hitsOf(tree, keys, editable);

    const count = new Map();
    for (const matched of carried.values()) {
      for (const key of matched) count.set(key, (count.get(key) || 0) + 1);
    }
    const generic = new Set();
    for (const [key, hits] of count) {
      if (hits <= MAX_HITS) continue;
      generic.add(key);
      skipped.push({ item: item.id, key, hits });
    }

    for (const [hit, matched] of carried) {
      // The longest surviving key: `renderTile` is evidence where `tile` is a coincidence.
      const via = matched
        .filter((key) => !generic.has(key))
        .sort((left, right) => right.length - left.length)[0];
      if (!via) continue;
      const other = (open || []).find(
        (entry) => entry.id !== item.id && ownedBy(hit, entry.ownership && entry.ownership.editable)
      );
      found.push({
        item: item.id,
        path: hit,
        owned: keys.get(via).owned,
        via,
        ownedBy: other ? other.id : null,
      });
    }
  }
  return { found, skipped };
}

function line(entry) {
  return entry.ownedBy
    ? `candidate ${entry.item} ${entry.path} owned-by ${entry.ownedBy} via ${entry.via}`
    : `candidate ${entry.item} ${entry.path} references ${entry.owned} via ${entry.via}`;
}

/** One item's share of the frontier print: ten candidates, the rest counted, then its skips. */
function candidateLines(closure) {
  const { found, skipped } = closure;
  const out = [];
  for (const id of [...new Set(found.map((entry) => entry.item))]) {
    const mine = found.filter((entry) => entry.item === id);
    out.push(...mine.slice(0, MAX_PER_ITEM).map(line));
    if (mine.length > MAX_PER_ITEM) out.push(`candidates ${id} and ${mine.length - MAX_PER_ITEM} more`);
  }
  for (const entry of skipped) out.push(`skipped ${entry.item} ${entry.key} (${entry.hits} hits)`);
  return out;
}

module.exports = { candidateLines, candidates };
