'use strict';

/**
 * What a mutate may break: a committed file of the tree, and in a batch a list of entries
 * `{criterion, file, line, find, replace, test}`. `find` occurs exactly once on that line and
 * `replace` is its broken version, both on one line. A batch is JSON or the YAML subset of
 * run-yaml.cjs. Every entry is checked before anything is written, so a bad entry refuses the
 * whole batch and touches nothing.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

const { RunError } = lib;
const KEYS = ['criterion', 'file', 'line', 'find', 'replace', 'test'];

/** A committed file of `tree`, with its bytes and its lines. A file nothing could restore is refused. */
function committedFile(tree, file) {
  const rel = path.relative(tree, path.resolve(tree, file)).split(path.sep).join('/');
  if (rel.startsWith('../') || path.isAbsolute(rel)) throw new RunError(`${file} is outside ${tree}`, 'BAD_TARGET');
  if (lib.git(tree, ['ls-files', '--error-unmatch', '--', rel], { tolerate: true }) === null) {
    throw new RunError(`${rel} is not a committed file, so nothing could restore it`, 'BAD_TARGET');
  }
  const abs = path.join(tree, rel);
  const original = fs.readFileSync(abs);
  const lines = original.toString('utf8').split('\n');
  const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  return { rel, abs, original, lines, count };
}

/** How often `find` occurs in `line`, overlaps included. */
function occurrences(line, find) {
  let count = 0;
  for (let at = line.indexOf(find); at !== -1; at = line.indexOf(find, at + 1)) count += 1;
  return count;
}

function entry(tree, raw, k) {
  const at = `entry ${k}`;
  const bad = (message) => new RunError(`${at}: ${message}`, 'BAD_BATCH');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad(`it is not a map of ${KEYS.join(', ')}`);
  const unknown = Object.keys(raw).filter((key) => !KEYS.includes(key));
  if (unknown.length > 0) throw bad(`it holds ${unknown.join(', ')}; an entry holds ${KEYS.join(', ')} only`);
  const text = (key, empty = false) => {
    const value = typeof raw[key] === 'number' && key === 'criterion' ? String(raw[key]) : raw[key];
    if (typeof value !== 'string' || (!empty && value.trim() === '')) throw bad(`it needs ${key} as text`);
    return value;
  };
  const [criterion, file, find, replace, test] = [text('criterion'), text('file'), text('find'), text('replace', true), text('test')];
  if (find.includes('\n') || replace.includes('\n')) throw bad('find and replace stay on one line');
  const target = (message) => new RunError(`${at}: ${message}`, 'BAD_TARGET');
  const { rel, abs, lines, count } = committedFile(tree, file);
  const n = Number(raw.line);
  if (!Number.isInteger(n) || n < 1 || n > count) throw target(`line ${raw.line} is not a line of ${rel} (1 to ${count})`);
  const times = occurrences(lines[n - 1], find);
  if (times !== 1) throw target(`find occurs ${times} times on ${rel}:${n}; it must occur there exactly once`);
  if (find === replace) throw target(`replace leaves ${rel}:${n} as it is, so it is no mutant`);
  return { k, criterion, rel, abs, n, col: lines[n - 1].indexOf(find), find, replace, test, rust: rel.endsWith('.rs') };
}

/** The checked entries of the batch at `file`, numbered from 1 in their order. */
function readBatch(tree, file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new RunError(`cannot read the batch ${file}: ${error.code || error.message}`, 'BAD_BATCH');
  }
  let doc;
  try {
    doc = /^\s*[[{]/.test(text) ? JSON.parse(text) : lib.parseYaml(text);
  } catch (error) {
    throw new RunError(`the batch ${file} is neither JSON nor the YAML this runner reads (${error.message}); ` +
      'quote any value that holds a #, a colon or a quote', 'BAD_BATCH');
  }
  if (!Array.isArray(doc) || doc.length === 0) {
    throw new RunError(`the batch ${file} must be a list of entries {${KEYS.join(', ')}}`, 'BAD_BATCH');
  }
  return doc.map((raw, index) => entry(tree, raw, index + 1));
}

module.exports = { committedFile, readBatch };
