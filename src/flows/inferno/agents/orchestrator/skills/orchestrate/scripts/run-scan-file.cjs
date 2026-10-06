'use strict';

/**
 * The scan's four questions, the result file a scanner writes, and the scan.yaml that
 * `run.cjs scan --collect` records for the intent review.
 *
 * Split from run-scan.cjs because the schema is a contract of its own: the scanner role
 * writes to it, the collect reads it, and the intent review answers every line it records.
 * A line without the command that proves it is refused, because a suspicion nobody can rerun
 * costs the reviewer a search instead of a check.
 */

const fs = require('fs');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

const QUESTIONS = {
  wiring: 'a screen or reader with no producer; a command, table or event with no consumer; ' +
    'a caller of a replaced reader that did not change.',
  contract: 'a command, error variant or event with no test that runs the real producer; ' +
    'a test double that fakes more than network, clock, keys or outages.',
  reread: 'a screen that does not re-read after save, product switch or decision.',
  'live-path': 'a write, OS path, process, network call or restart with no fault-seam or smoke test.',
};
const IDS = Object.keys(QUESTIONS);
const RESULT_KEYS = ['question', 'lines'];
const LINE_KEYS = ['file', 'line', 'claim', 'proof'];
const SCAN_LINE_KEYS = ['id', 'scanner', ...LINE_KEYS];

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function bad(file, id, problem, fix) {
  return new RunError(`${file}: ${problem}. send this back to the ${id} scanner, then run ${fix} again.`, 'BAD_SCAN', 2);
}

/**
 * The lines of one scanner's result file, each with the command that proves it. `fix` is the
 * collect command the refusal prints.
 */
function readResult(file, id, fix) {
  let doc;
  try {
    doc = lib.parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    throw bad(file, id, `cannot read it: ${error.message}`, fix);
  }
  if (!isMap(doc)) throw bad(file, id, `a result is a map of ${RESULT_KEYS.join(', ')}`, fix);
  for (const key of Object.keys(doc)) {
    if (!RESULT_KEYS.includes(key)) throw bad(file, id, `unknown key ${key}: a result holds ${RESULT_KEYS.join(', ')} only`, fix);
  }
  if (doc.question !== id) throw bad(file, id, `question must be ${id}, the question this scanner was sent`, fix);
  const lines = doc.lines === undefined || doc.lines === '' ? [] : doc.lines;
  if (!Array.isArray(lines)) throw bad(file, id, 'lines must be a list, `lines: []` when nothing is missing', fix);
  return lines.map((line, index) => {
    const at = `line ${index + 1}`;
    if (!isMap(line)) throw bad(file, id, `${at} must be a map of ${LINE_KEYS.join(', ')}`, fix);
    for (const key of Object.keys(line)) {
      if (!LINE_KEYS.includes(key)) throw bad(file, id, `unknown key ${key} in ${at}: it holds ${LINE_KEYS.join(', ')} only`, fix);
    }
    for (const key of LINE_KEYS) {
      if (typeof line[key] !== 'string' || line[key].trim() === '') {
        const why = key === 'proof' ? ': every line carries the command that proves it' : '';
        throw bad(file, id, `${at} has no ${key}${why}`, fix);
      }
    }
    return { file: line.file, line: line.line, claim: line.claim, proof: line.proof };
  });
}

/** Double-quoted for the flow's own YAML parser, which reads \" \\ \n \t \r and no other escape. */
function quoted(value) {
  const text = String(value)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
    .replace(/[\u0000-\u001f\u007f]/g, ''); // eslint-disable-line no-control-regex
  return `"${text}"`;
}

/** Every line of the results, numbered per scanner in the order of the questions. */
function numbered(results) {
  const lines = [];
  for (const id of IDS) {
    (results[id] || []).forEach((line, index) => lines.push({ id: `${id}-${index + 1}`, scanner: id, ...line }));
  }
  return lines;
}

/** The collected scan: every line numbered per scanner, then the tree and commit it read. */
function renderScan({ intent, range, results, tree, commit }) {
  const lines = numbered(results);
  const out = [`intent: ${intent}`, `range: ${range}`];
  if (lines.length === 0) out.push('lines: []');
  else {
    out.push('lines:');
    for (const line of lines) {
      SCAN_LINE_KEYS.forEach((key, index) => out.push(`${index === 0 ? '  - ' : '    '}${key}: ${quoted(line[key])}`));
    }
  }
  out.push(`tree: ${tree}`, `commit: ${commit}`);
  return { text: `${out.join('\n')}\n`, lines };
}

module.exports = { IDS, LINE_KEYS, QUESTIONS, RESULT_KEYS, SCAN_LINE_KEYS, numbered, readResult, renderScan };
