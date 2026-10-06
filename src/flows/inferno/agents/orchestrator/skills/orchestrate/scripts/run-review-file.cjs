'use strict';

/**
 * The review file a cold reviewer writes, and the schema it is held to.
 *
 * Split from run-review.cjs because the schema is a contract of its own: the reviewer agent
 * writes to it and the step reads it, and nothing else may ride along. An unknown key is
 * refused rather than ignored, because a key nobody reads is where a reviewer would park a
 * "residual risk" the builder never sees.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

const ITEM_KEYS = ['item', 'verdict', 'files', 'findings', 'mutants'];
/** What run.cjs adds when it records a review. A reviewer that writes them is refused. */
const RECORDED_KEYS = ['tree', 'commit'];
const FINDING_KEYS = ['criterion', 'file', 'line', 'evidence', 'fix'];
const MUTANT_KEYS = ['criterion', 'test', 'caught'];

function reviewPath(intentId, itemId) {
  return path.join(lib.SPECS_DIR, 'intents', intentId, 'reviews', `${itemId}.yaml`);
}

function bad(rel, problem) {
  return new RunError(`${rel}: ${problem}. send this back to the reviewer that wrote the file, then run the same command again.`, 'BAD_REVIEW', 2);
}

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A list field, where an empty value or `[]` is the empty list. */
function listOf(rel, doc, key) {
  const value = doc[key];
  if (value === undefined || value === '') return [];
  if (!Array.isArray(value)) throw bad(rel, `${key} must be a list`);
  return value;
}

/** Every entry of a findings or mutants list holds exactly `keys`, each with a value. */
function entries(rel, doc, key, keys) {
  return listOf(rel, doc, key).map((entry, index) => {
    if (!isMap(entry)) throw bad(rel, `${key} entry ${index + 1} must be a map of ${keys.join(', ')}`);
    for (const name of Object.keys(entry)) {
      if (!keys.includes(name)) throw bad(rel, `unknown key ${name} in ${key} entry ${index + 1}: it holds ${keys.join(', ')} only`);
    }
    for (const name of keys) {
      if (typeof entry[name] !== 'string' || entry[name].trim() === '') {
        throw bad(rel, `${key} entry ${index + 1} has no ${name}`);
      }
    }
    return entry;
  });
}

/** The files a review binds: paths inside the tree, outside the ledger, present on disk. */
function boundFiles(tree, rel, doc) {
  const files = listOf(rel, doc, 'files');
  if (files.length === 0) throw bad(rel, 'files must list every file the review read for this item');
  for (const file of files) {
    if (typeof file !== 'string' || file.trim() === '') throw bad(rel, 'files holds paths only');
    const normal = path.posix.normalize(file);
    if (path.isAbsolute(file) || normal.startsWith('../') || normal === '..') {
      throw bad(rel, `files lists ${file}, a path outside the tree; list paths relative to the tree`);
    }
    if (normal === lib.SPECS_DIR || normal.startsWith(`${lib.SPECS_DIR}/`)) {
      throw bad(rel, `files lists ${file}; the ledger is never part of the code a review binds`);
    }
    if (!fs.existsSync(path.join(tree, normal))) throw bad(rel, `files lists ${file}, which is not in the tree`);
  }
  return [...new Set(files.map((file) => path.posix.normalize(file)))];
}

/**
 * Read and validate one item review. `recorded` is true for a file run.cjs already recorded,
 * which carries the tree and commit it added; a fresh file may not carry them.
 */
function parseItemReview(tree, rel, itemId, { recorded }) {
  let doc;
  try {
    doc = lib.parseYaml(fs.readFileSync(path.join(tree, rel), 'utf8'));
  } catch (error) {
    if (error instanceof RunError) throw bad(rel, error.message.replace(/\.$/, ''));
    throw error;
  }
  if (!isMap(doc)) throw bad(rel, 'an item review is a map of item, verdict, files, findings and mutants');
  for (const key of Object.keys(doc)) {
    if (ITEM_KEYS.includes(key) || (recorded && RECORDED_KEYS.includes(key))) continue;
    if (RECORDED_KEYS.includes(key)) throw bad(rel, `${key} is written by run.cjs when it records the review, so drop it`);
    throw bad(rel, `unknown key ${key}: an item review holds item, verdict, files, findings and mutants only`);
  }
  if (doc.item !== itemId) throw bad(rel, `item reads ${doc.item || 'nothing'}, and this is the review of ${itemId}`);
  if (doc.verdict !== 'clean' && doc.verdict !== 'fix') throw bad(rel, 'verdict must be clean or fix');

  const files = boundFiles(tree, rel, doc);
  const findings = entries(rel, doc, 'findings', FINDING_KEYS);
  for (const finding of findings) {
    if (!/^\d+$/.test(finding.line)) throw bad(rel, `finding line must be a line number, not ${finding.line}`);
  }
  const mutants = entries(rel, doc, 'mutants', MUTANT_KEYS);
  for (const mutant of mutants) {
    if (mutant.caught !== 'yes' && mutant.caught !== 'no') throw bad(rel, 'mutant caught must be yes or no');
  }
  const survivors = mutants.filter((mutant) => mutant.caught === 'no');

  // A surviving mutant is a finding too: a test that misses a broken criterion proves nothing.
  if (doc.verdict === 'clean' && findings.length > 0) {
    throw bad(rel, `verdict clean with ${findings.length} finding(s); a review with a finding says fix`);
  }
  if (doc.verdict === 'clean' && survivors.length > 0) {
    throw bad(rel, 'verdict clean with a mutant that reads caught: no; a surviving mutant says fix');
  }
  if (doc.verdict === 'fix' && findings.length === 0 && survivors.length === 0) {
    throw bad(rel, 'verdict fix with no finding and no surviving mutant; name what to fix or say clean');
  }
  return { item: itemId, verdict: doc.verdict, files, findings, mutants, survivors };
}

module.exports = { parseItemReview, reviewPath };
