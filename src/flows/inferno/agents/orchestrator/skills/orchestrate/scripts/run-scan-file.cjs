'use strict';

/**
 * The scan's four questions, the result file a scanner writes, and the scan.yaml that
 * `run.cjs scan --collect` records for the intent review.
 *
 * Split from run-scan.cjs because the schema is a contract of its own: the scanner role
 * writes to it, the collect reads it, and the intent review answers every line it records.
 * A line without the command that proves it is refused, because a suspicion nobody can rerun
 * costs the reviewer a search instead of a check.
 *
 * At plan time every line also carries its kind, and only a LEGAL or MAKER line blocks the
 * plan. A plan pins code-level detail for a tree not built yet, so a BUILD line is plumbing a
 * builder's red-first test and the gate catch in minutes, and a plan chasing it never converges.
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

/** What a plan-time line can be, and the kinds that block the plan. */
const PLAN_KINDS = {
  LEGAL: 'a provision, limb, date, act line or scope encoded wrong or missing, measured against the research and the primary texts.',
  MAKER: 'what the maker sees or gets is wrong: a screen, a reader-facing string, a dossier or document outcome, ' +
    'a wrong result for a concrete product, a stored answer that is lost.',
  BUILD: 'how a builder proves or wires the work: test files and their fixtures, recorded wire files, test helpers and ' +
    'selectors, ownership lists, verification budgets, closure lists, line numbers and counts inside tests. ' +
    "It never blocks the plan: the builder's red-first test and the gate own it.",
};
const BLOCKING_KINDS = ['LEGAL', 'MAKER'];
const KIND_LIST = 'LEGAL, MAKER or BUILD';

/** The plan-time question: nothing is built, so only the law and what the maker sees or gets can block. */
const PLAN_QUESTION = 'what in the plan encodes the law wrong or gives the maker the wrong thing, ' +
  'including a screen or reader with no producer and an answer the maker gives that nothing stores. ' +
  `Tag every line with its kind, ${KIND_LIST}, and spend no search on BUILD.`;
const RESULT_KEYS = ['question', 'lines'];
const LINE_KEYS = ['file', 'line', 'claim', 'proof'];
const SCAN_LINE_KEYS = ['id', 'scanner', ...LINE_KEYS];

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function bad(file, id, problem, fix, scanner = id) {
  return new RunError(`${file}: ${problem}. send this back to the ${scanner} scanner, then run ${fix} again.`, 'BAD_SCAN', 2);
}

/**
 * The lines of one scanner's result file, each with the command that proves it. `fix` is the
 * collect command the refusal prints, `scanner` the slice a refusal names when it is not `id`.
 */
function readResult(file, id, fix, scanner = id, plan = false) {
  const refuse = (problem) => bad(file, id, problem, fix, scanner);
  let doc;
  try {
    doc = lib.parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    throw refuse(`cannot read it: ${error.message}`);
  }
  if (!isMap(doc)) throw refuse(`a result is a map of ${RESULT_KEYS.join(', ')}`);
  for (const key of Object.keys(doc)) {
    if (!RESULT_KEYS.includes(key)) throw refuse(`unknown key ${key}: a result holds ${RESULT_KEYS.join(', ')} only`);
  }
  if (doc.question !== id) throw refuse(`question must be ${id}, the question this scanner was sent`);
  const lines = doc.lines === undefined || doc.lines === '' ? [] : doc.lines;
  if (!Array.isArray(lines)) throw refuse('lines must be a list, `lines: []` when nothing is missing');
  const keys = plan ? [...LINE_KEYS, 'kind'] : LINE_KEYS;
  return lines.map((line, index) => {
    const at = `line ${index + 1}`;
    if (!isMap(line)) throw refuse(`${at} must be a map of ${keys.join(', ')}`);
    for (const key of Object.keys(line)) {
      if (!keys.includes(key)) throw refuse(`unknown key ${key} in ${at}: it holds ${keys.join(', ')} only`);
    }
    if (plan && !Object.prototype.hasOwnProperty.call(PLAN_KINDS, line.kind)) {
      throw refuse(`${at} has kind ${line.kind === undefined ? 'none' : line.kind}: a plan-time line is ${KIND_LIST}`);
    }
    for (const key of LINE_KEYS) {
      if (typeof line[key] !== 'string' || line[key].trim() === '') {
        const why = key === 'proof' ? ': every line carries the command that proves it' : '';
        throw refuse(`${at} has no ${key}${why}`);
      }
    }
    const read = { file: line.file, line: line.line, claim: line.claim, proof: line.proof };
    return plan ? { ...read, kind: line.kind } : read;
  });
}

/** Double-quoted for the flow's own YAML parser, which reads \" \\ \n \t \r and no other escape. */
function quoted(value) {
  const text = String(value)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
    .replace(/[\u0000-\u001f\u007f]/g, ''); // eslint-disable-line no-control-regex
  return `"${text}"`;
}

/**
 * Every line of the results, numbered per question. `results` maps a question to its lines,
 * read in the order of the questions, or lists `{ question, lines }` per slice in order, so a
 * question split over slices numbers on across them and no two lines share an id.
 */
function numbered(results) {
  const entries = Array.isArray(results) ? results : IDS.map((id) => ({ question: id, lines: results[id] }));
  const counts = {};
  const lines = [];
  for (const { question, lines: found } of entries) {
    for (const line of found || []) {
      counts[question] = (counts[question] || 0) + 1;
      lines.push({ id: `${question}-${counts[question]}`, scanner: question, ...line });
    }
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

module.exports = {
  BLOCKING_KINDS, IDS, LINE_KEYS, PLAN_KINDS, PLAN_QUESTION, QUESTIONS, RESULT_KEYS, SCAN_LINE_KEYS, numbered, readResult, renderScan,
};
