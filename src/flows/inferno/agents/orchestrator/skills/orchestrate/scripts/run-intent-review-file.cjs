'use strict';

/**
 * The intent review file a cold reviewer writes before the gate, and the schema it is held to.
 *
 * The same contract as the item review in run-review-file.cjs: only the keys below, every
 * entry complete, and the verdict held to what the file found. On top of that, every finding
 * names the work item that owns its fix, every scan line gets an answer, and a criterion only
 * a person or another machine can prove names the evidence the merge waits for.
 */

const {
  FINDING_KEYS, RECORDED_KEYS, bad, entries, isMap, readDoc, relativePath, verdictParts,
} = require('./run-review-file.cjs');
const { mutantGaps } = require('./run-mutant-coverage.cjs');

const INTENT_KEYS = ['verdict', 'criteria', 'findings', 'scanner', 'mutants'];
const CRITERION_KEYS = ['criterion', 'proof', 'where'];
const PROOFS = ['test', 'code', 'external'];
const SCANNER_KEYS = ['id', 'answer', 'reason'];
const ANSWERS = ['confirmed', 'struck'];

function criteriaOf(rel, doc) {
  return entries(rel, doc, 'criteria', CRITERION_KEYS, ['evidence']).map((entry, index) => {
    const at = `criteria entry ${index + 1}`;
    if (!PROOFS.includes(entry.proof)) throw bad(rel, `${at} proof must be test, code or external`);
    if (entry.proof === 'external' && entry.evidence === undefined) {
      throw bad(rel, `${at} is proven externally and names no evidence path; the merge waits for that path`);
    }
    if (entry.proof !== 'external' && entry.evidence !== undefined) {
      throw bad(rel, `${at} carries evidence, which is for an external proof only`);
    }
    return entry.evidence === undefined ? entry : { ...entry, evidence: relativePath(rel, entry.evidence, at) };
  });
}

/** Every scan line answered once, and no answer to a line the scan does not hold. */
function scannerOf(rel, doc, scanIds) {
  const answers = entries(rel, doc, 'scanner', SCANNER_KEYS);
  const answered = new Set();
  for (const answer of answers) {
    if (!ANSWERS.includes(answer.answer)) throw bad(rel, `scan line ${answer.id} answer must be confirmed or struck`);
    if (!scanIds.includes(answer.id)) throw bad(rel, `scanner answers ${answer.id}, a line the scan does not hold`);
    if (answered.has(answer.id)) throw bad(rel, `scan line ${answer.id} is answered twice`);
    answered.add(answer.id);
  }
  const open = scanIds.filter((id) => !answered.has(id));
  if (open.length > 0) {
    throw bad(rel, `scan line ${open.slice(0, 5).join(', ')} has no answer; answer every line confirmed or struck`);
  }
  return answers;
}

/**
 * Read and validate the intent review. `items` are the ids of the intent's work items,
 * `scanIds` the ids of the collected scan's lines (none when no scan ran). `recorded` is
 * true for a file run.cjs already recorded, which carries the tree and commit it added.
 * `proofs` holds what each item owes in mutants (run-mutant-coverage.cjs itemProofs).
 */
function parseIntentReview(tree, rel, { recorded, items, scanIds, proofs = [] }) {
  const doc = readDoc(tree, rel);
  if (!isMap(doc)) throw bad(rel, `an intent review is a map of ${INTENT_KEYS.join(', ')}`);
  for (const key of Object.keys(doc)) {
    if (INTENT_KEYS.includes(key) || (recorded && RECORDED_KEYS.includes(key))) continue;
    if (RECORDED_KEYS.includes(key)) throw bad(rel, `${key} is written when the review is recorded, so drop it`);
    throw bad(rel, `unknown key ${key}: an intent review holds ${INTENT_KEYS.join(', ')} only`);
  }
  if (doc.verdict !== 'clean' && doc.verdict !== 'fix') throw bad(rel, 'verdict must be clean or fix');
  const criteria = criteriaOf(rel, doc);
  const { findings, mutants, survivors } = verdictParts(rel, doc, [...FINDING_KEYS, 'owner']);
  for (const finding of findings) {
    if (!items.includes(finding.owner)) {
      throw bad(rel, `finding at ${finding.file}:${finding.line} names owner ${finding.owner}, which is no work item of this intent`);
    }
  }
  const scanner = scannerOf(rel, doc, scanIds);
  const gaps = doc.verdict === 'clean' ? mutantGaps(proofs, mutants) : [];
  if (gaps.length > 0) {
    throw bad(rel, `verdict clean while ${gaps.join('; ')}. Break each with the runner's mutate step and record it under mutants, ` +
      'here as <item>:<n> or the criterion text, or in that item\'s review');
  }
  return {
    verdict: doc.verdict, criteria, findings, mutants, survivors, scanner,
    tree: typeof doc.tree === 'string' ? doc.tree : null,
    commit: typeof doc.commit === 'string' ? doc.commit : null,
  };
}

module.exports = { CRITERION_KEYS, INTENT_KEYS, SCANNER_KEYS, parseIntentReview };
