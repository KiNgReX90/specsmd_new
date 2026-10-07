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
const RECORDED_KEYS = ['tree', 'commit', 'reviewer'];
/**
 * A reviewer's agent id as the host returns it: the id on Claude, the task path such as
 * /root/review_a_one on Codex. One token, so never the placeholder a record call prints.
 */
const AGENT_ID = /^[\w./:-]+$/;
const FINDING_KEYS = ['criterion', 'file', 'line', 'evidence', 'fix', 'severity'];
/** The severities a finding may carry, as the refusal of a finding without one names them. */
const SEVERITIES = ['blocker', 'major', 'minor'];
const SEVERITY_FIX = 'blocker when the change breaks a criterion or other behaviour, major when a criterion is unproven ' +
  'or a test proves nothing, minor for any other defect';
const MUTANT_KEYS = ['criterion', 'test', 'caught'];

function reviewPath(intentId, itemId) {
  return path.join(lib.SPECS_DIR, 'intents', intentId, 'reviews', `${itemId}.yaml`);
}

/**
 * The agent id a review is recorded under, so the next review of the same item or intent
 * resumes that reviewer. `call` is the record call to run instead.
 */
function reviewerId(value, call) {
  if (typeof value === 'string' && AGENT_ID.test(value)) return value;
  throw new RunError(`refusing to record the review without the agent id of the reviewer that wrote it${value ? `, and ${value} is none` : ''}: ` +
    `run ${call} with <agent-id> replaced by the id the host returned when it spawned the reviewer, or the id it resumed.`, 'NO_REVIEWER', 2);
}

/** The reviewer a recorded review names, or null for a record written before reviewers were. */
const recordedReviewer = (doc) => (typeof doc.reviewer === 'string' && AGENT_ID.test(doc.reviewer) ? doc.reviewer : null);

function bad(rel, problem) {
  return new RunError(`${rel}: ${problem}. send this back to the reviewer that wrote the file, then run the same command again.`, 'BAD_REVIEW', 2);
}

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A value as a refusal names it: the text, or the shape that is no text. */
function reads(value) {
  if (typeof value === 'string' && value.trim() !== '') return value;
  return Array.isArray(value) ? 'a list' : isMap(value) ? 'a map' : 'nothing';
}

/** A list field, where an empty value or `[]` is the empty list. */
function listOf(rel, doc, key) {
  const value = doc[key];
  if (value === undefined || value === '') return [];
  if (!Array.isArray(value)) throw bad(rel, `${key} must be a list`);
  return value;
}

/**
 * Every entry of a list holds `keys`, each with a value, plus at most the `optional` ones,
 * which carry a value when present. The `held` ones the caller checks itself, so its refusal
 * names what they may hold.
 */
function entries(rel, doc, key, keys, optional = [], held = []) {
  const known = [...keys, ...optional];
  return listOf(rel, doc, key).map((entry, index) => {
    if (!isMap(entry)) throw bad(rel, `${key} entry ${index + 1} must be a map of ${known.join(', ')}`);
    for (const name of Object.keys(entry)) {
      if (!known.includes(name)) throw bad(rel, `unknown key ${name} in ${key} entry ${index + 1}: it holds ${known.join(', ')} only`);
    }
    for (const name of known) {
      if (held.includes(name) || (!keys.includes(name) && entry[name] === undefined)) continue;
      if (typeof entry[name] !== 'string' || entry[name].trim() === '') {
        throw bad(rel, `${key} entry ${index + 1} has no ${name}`);
      }
    }
    return entry;
  });
}

/** A path a review names: relative, inside the tree. */
function relativePath(rel, file, what) {
  const normal = path.posix.normalize(file);
  if (path.isAbsolute(file) || normal.startsWith('../') || normal === '..') {
    throw bad(rel, `${what} names ${file}, a path outside the tree; name paths relative to the tree`);
  }
  return normal;
}

/** The files a review binds: paths inside the tree, outside the ledger, present on disk. */
function boundFiles(tree, rel, doc) {
  const files = listOf(rel, doc, 'files');
  if (files.length === 0) throw bad(rel, 'files must list every file the review read for this item');
  for (const file of files) {
    if (typeof file !== 'string' || file.trim() === '') throw bad(rel, 'files holds paths only');
    const normal = relativePath(rel, file, 'files');
    if (normal === lib.SPECS_DIR || normal.startsWith(`${lib.SPECS_DIR}/`)) {
      throw bad(rel, `files lists ${file}; the ledger is never part of the code a review binds`);
    }
    if (!fs.existsSync(path.join(tree, normal))) throw bad(rel, `files lists ${file}, which is not in the tree`);
  }
  return [...new Set(files.map((file) => path.posix.normalize(file)))];
}

/** A review file as data; a YAML error goes back to the reviewer like any other. */
function readDoc(tree, rel) {
  try {
    return lib.parseYaml(fs.readFileSync(path.join(tree, rel), 'utf8'));
  } catch (error) {
    if (error instanceof RunError) throw bad(rel, error.message.replace(/\.$/, ''));
    throw error;
  }
}

/**
 * Read and validate one item review. `recorded` is true for a file run.cjs already recorded,
 * which carries the tree and commit it added; a fresh file may not carry them.
 */
function parseItemReview(tree, rel, itemId, { recorded }) {
  const doc = readDoc(tree, rel);
  if (!isMap(doc)) throw bad(rel, 'an item review is a map of item, verdict, files, findings and mutants');
  for (const key of Object.keys(doc)) {
    if (ITEM_KEYS.includes(key) || (recorded && RECORDED_KEYS.includes(key))) continue;
    if (RECORDED_KEYS.includes(key)) throw bad(rel, `${key} is written when the review is recorded, so drop it`);
    throw bad(rel, `unknown key ${key}: an item review holds item, verdict, files, findings and mutants only`);
  }
  if (doc.item !== itemId) throw bad(rel, `item reads ${doc.item || 'nothing'}, and this is the review of ${itemId}`);
  if (doc.verdict !== 'clean' && doc.verdict !== 'fix') throw bad(rel, 'verdict must be clean or fix');

  const files = boundFiles(tree, rel, doc);
  const { findings, mutants, survivors } = verdictParts(rel, doc, FINDING_KEYS, ['repeat']);
  for (const [index, finding] of findings.entries()) {
    if (finding.repeat !== undefined && finding.repeat !== 'true') {
      throw bad(rel, `findings entry ${index + 1} repeat reads ${reads(finding.repeat)}; write repeat: true when an earlier ` +
        'round of this item reported the same kind, or leave it out');
    }
  }
  return { item: itemId, verdict: doc.verdict, files, findings, mutants, survivors, reviewer: recorded ? recordedReviewer(doc) : null };
}

/**
 * What a fix review weighs on the ladder. It counts when a finding is blocker or major, or a
 * mutant survived; minor findings alone do not. A finding that repeats an earlier round
 * sends the review to the oracle, whatever it counts.
 */
function weightOf(review) {
  const serious = review.survivors.length > 0 || review.findings.some((finding) => finding.severity !== 'minor');
  const repeat = review.findings.some((finding) => finding.repeat === 'true');
  return { serious, weight: repeat ? 'repeat' : serious ? 'serious' : 'minor' };
}

/**
 * The findings and mutants of an item or intent review, held to its verdict. A surviving
 * mutant is a finding too: a test that misses a broken criterion proves nothing.
 */
function verdictParts(rel, doc, findingKeys, optional = []) {
  // Severity is held below, so a finding without one is refused with the three it may carry.
  const required = findingKeys.filter((key) => key !== 'severity');
  const findings = entries(rel, doc, 'findings', required, ['severity', ...optional], ['severity', ...optional]);
  for (const [index, finding] of findings.entries()) {
    if (!/^\d+$/.test(finding.line)) throw bad(rel, `finding line must be a line number, not ${finding.line}`);
    if (!SEVERITIES.includes(finding.severity)) {
      throw bad(rel, `findings entry ${index + 1} severity reads ${reads(finding.severity)}; it must be ${SEVERITY_FIX}`);
    }
  }
  const mutants = entries(rel, doc, 'mutants', MUTANT_KEYS);
  for (const mutant of mutants) {
    if (mutant.caught !== 'yes' && mutant.caught !== 'no') throw bad(rel, 'mutant caught must be yes or no');
  }
  const survivors = mutants.filter((mutant) => mutant.caught === 'no');
  if (doc.verdict === 'clean' && findings.length > 0) {
    throw bad(rel, `verdict clean with ${findings.length} finding(s); a review with a finding says fix`);
  }
  if (doc.verdict === 'clean' && survivors.length > 0) {
    throw bad(rel, 'verdict clean with a mutant that reads caught: no; a surviving mutant says fix');
  }
  if (doc.verdict === 'fix' && findings.length === 0 && survivors.length === 0) {
    throw bad(rel, 'verdict fix with no finding and no surviving mutant; name what to fix or say clean');
  }
  return { findings, mutants, survivors };
}

module.exports = {
  FINDING_KEYS, ITEM_KEYS, MUTANT_KEYS, RECORDED_KEYS, SEVERITIES, bad, entries, isMap, parseItemReview, readDoc, recordedReviewer, relativePath,
  reviewPath, reviewerId, verdictParts, weightOf,
};
