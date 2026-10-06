'use strict';

/**
 * Which paths an `ownership.editable` entry covers, and whether two entries can name the same
 * file. One predicate serves dispatch, batching and verification, so the scheduler can never
 * send two builders to a file that verify-item would then attribute to only one of them.
 *
 * An entry is a repository-relative path or glob. A plain path owns itself and everything
 * below it, with or without a trailing slash. `./`, `a/../b` and, given the tree, a directory
 * symlink resolve to the real path first, so an alias cannot slip a write past ownership. An
 * entry or a symlink that leaves the tree is refused rather than ignored.
 *
 * Zero dependencies and no require of run-lib.cjs: run-lib re-exports these as its own.
 */

const fs = require('fs');
const path = require('path');

const GLOB = /[*?[]/;

/** The entry as a normalized path relative to the tree, its symlinked prefix resolved. */
function canonical(entry, tree) {
  if (typeof entry !== 'string' || !entry.trim()) throw Error('Ownership requires a path');
  const root = tree && fs.realpathSync(tree);
  let value = entry.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && path.isAbsolute(value)) value = path.relative(root, value).replace(/\\/g, '/');
  value = path.posix.normalize(value).replace(/^\.\//, '');
  if (value === '..' || value.startsWith('../') || path.isAbsolute(value)) {
    throw Error(`Ownership escapes the tree: ${entry}`);
  }
  if (!root) return value;
  // Resolve the longest existing prefix before the first glob segment: a symlinked directory
  // there is the alias, and what lies past it may not exist yet.
  const parts = value.split('/');
  let count = parts.findIndex((part) => GLOB.test(part));
  if (count === -1) count = parts.length;
  while (count && !fs.existsSync(path.join(root, ...parts.slice(0, count)))) count -= 1;
  const prefix = fs.realpathSync(path.join(root, ...parts.slice(0, count)));
  value = path.relative(root, path.join(prefix, ...parts.slice(count))).replace(/\\/g, '/') || '.';
  if (value === '..' || value.startsWith('../')) throw Error(`Ownership alias escapes the tree: ${entry}`);
  return value;
}

/** One path segment as tokens: a literal, `?`, `*` or a `[...]` class. */
function segmentTokens(value) {
  const tokens = [];
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '[') {
      const end = value.indexOf(']', i + 1);
      if (end === -1) throw Error(`Unclosed ownership character class: ${value}`);
      const regex = new RegExp(`^[${value.slice(i + 1, end).replace(/^!/, '^')}]$`);
      tokens.push({ accepts: (letter) => regex.test(letter) });
      i = end;
    } else {
      tokens.push({ star: char === '*', accepts: (letter) => char === '*' || char === '?' || char === letter });
    }
  }
  return tokens;
}

const ASCII = Array.from({ length: 127 }, (_, i) => String.fromCharCode(i + 1));

/** Whether some name matches both segment patterns: a search over the pair of positions. */
function segmentOverlap(a, b) {
  const left = segmentTokens(a);
  const right = segmentTokens(b);
  const alphabet = [...new Set([...a, ...b, ...ASCII])].filter((char) => char !== '/');
  const seen = new Set();
  const queue = [[0, 0]];
  while (queue.length) {
    const [i, j] = queue.pop();
    const key = `${i}:${j}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i === left.length && j === right.length) return true;
    if (left[i] && left[i].star) queue.push([i + 1, j]);
    if (right[j] && right[j].star) queue.push([i, j + 1]);
    if (!left[i] || !right[j]) continue;
    if (alphabet.some((char) => left[i].accepts(char) && right[j].accepts(char))) {
      queue.push([left[i].star ? i : i + 1, right[j].star ? j : j + 1]);
    }
  }
  return false;
}

/** Whether some path matches both patterns, `**` spanning any number of segments. */
function patternsOverlap(a, b) {
  const left = a.split('/');
  const right = b.split('/');
  const seen = new Set();
  const queue = [[0, 0]];
  while (queue.length) {
    const [i, j] = queue.pop();
    const key = `${i}:${j}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i === left.length && j === right.length) return true;
    if (left[i] === '**') queue.push([i + 1, j]);
    if (right[j] === '**') queue.push([i, j + 1]);
    if (i === left.length || j === right.length) continue;
    if (left[i] === '**' || right[j] === '**' || segmentOverlap(left[i], right[j])) {
      queue.push([left[i] === '**' ? i : i + 1, right[j] === '**' ? j : j + 1]);
    }
  }
  return false;
}

/** The entry as the glob of every path it owns. */
function pattern(entry, tree) {
  const normalized = canonical(entry, tree);
  if (normalized === '.') return '**';
  return GLOB.test(normalized) ? normalized : `${normalized}/**`;
}

/** Whether two ownership entries can name the same file. */
function overlaps(left, right, tree) {
  return patternsOverlap(pattern(left, tree), pattern(right, tree));
}

/** Whether `file` falls under one of an item's `ownership.editable` entries. */
function ownedBy(file, editable, tree) {
  const target = canonical(file, tree);
  return (editable || []).some((entry) => patternsOverlap(target, pattern(entry, tree)));
}

module.exports = { canonical, overlaps, ownedBy };
