'use strict';

/**
 * Whether the intent review holds for a tree, and what the gate and green owe without it.
 *
 * The review binds the whole tree by content (`proofs.scopeHash` with no scope), which leaves
 * out `.specs-inferno/`: a ledger commit, the review file itself and an archive move keep it
 * current, and any code change voids it. The gate checks it after its fold, so it never proves
 * a tree the reviewer did not read, and green checks it before every merge, which is the one
 * call both hosts and a hand merge make.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const { intentOf } = require('./run-worktrees.cjs');
const { parseIntentReview } = require('./run-intent-review-file.cjs');
const { itemProofs } = require('./run-mutant-coverage.cjs');

const { RunError } = lib;

/** An intent file: in the live intent dir, or in the archive once archive-intent moved it there. */
function intentFile(tree, intentId, name) {
  const live = path.join(lib.SPECS_DIR, 'intents', intentId, name);
  const archived = path.join(lib.SPECS_DIR, 'archive', 'intents', intentId, name);
  if (fs.existsSync(path.join(tree, live))) return live;
  if (fs.existsSync(path.join(tree, archived))) return archived;
  const liveDir = fs.existsSync(path.join(tree, path.dirname(live)));
  return !liveDir && fs.existsSync(path.join(tree, path.dirname(archived))) ? archived : live;
}

const intentReviewPath = (tree, intentId) => intentFile(tree, intentId, 'review.yaml');
const scanPath = (tree, intentId) => intentFile(tree, intentId, 'scan.yaml');

/** The intent a tree builds: `--intent`, else its `inferno-intent/<id>-<stamp>` branch. Fails closed. */
function intentFor(tree, options = {}) {
  if (options.intent) return options.intent;
  const branch = lib.currentBranch(tree);
  const id = intentOf(branch);
  if (id) return id;
  throw new RunError(
    `cannot tell which intent ${tree} builds: its branch ${branch} is no intent branch. Pass --intent <id>.`,
    'NO_INTENT'
  );
}

/** The work items of the intent, from its spec files, live or archived. */
function intentItems(tree, intentId) {
  const ids = new Set();
  for (const base of [['intents'], ['archive', 'intents']]) {
    const dir = path.join(tree, lib.SPECS_DIR, ...base, intentId, 'work-items');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) if (file.endsWith('.md')) ids.add(file.slice(0, -3));
  }
  return [...ids].sort();
}

/** The ids of the collected scan's lines, or null when no scan was collected. */
function scanIds(tree, intentId) {
  const rel = scanPath(tree, intentId);
  if (!fs.existsSync(path.join(tree, rel))) return null;
  const doc = lib.parseYaml(fs.readFileSync(path.join(tree, rel), 'utf8'));
  const lines = doc && Array.isArray(doc.lines) ? doc.lines : [];
  return lines.map((line) => (line && typeof line.id === 'string' ? line.id : null)).filter(Boolean);
}

/** The scan is owed on every host until `run.cjs scan --collect` recorded one for the intent. */
function scanOwed(tree, intentId) {
  return scanIds(tree, intentId) === null;
}

/** Validate a review file against the intent as it stands. */
function parseFor(tree, rel, intentId, recorded) {
  const items = intentItems(tree, intentId);
  return parseIntentReview(tree, rel, {
    recorded, items, scanIds: scanIds(tree, intentId) || [], proofs: itemProofs(tree, intentId, items),
  });
}

/**
 * The review as it holds for the tree: `owed` lists every reason it does not, empty when a
 * recorded review reads clean for the current content. `options` are the caller's, so the
 * scan calls a reason prints run on the caller's tree, intent and host.
 */
function intentReviewState(tree, config, intentId, options = {}) {
  const rel = intentReviewPath(tree, intentId);
  const owed = [];
  if (scanOwed(tree, intentId)) {
    owed.push(`the scan is owed: run ${scanCommand(tree, options)}, spawn the dispatch lines it prints, ` +
      `then run ${scanCommand(tree, options, true)} before the review`);
  }
  if (!fs.existsSync(path.join(tree, rel))) return { rel, review: null, owed: [...owed, 'no intent review yet'] };
  if (lib.gitLines(tree, ['status', '--porcelain', '--', rel]).length > 0) {
    return { rel, review: null, owed: [...owed, `${rel} is written but not recorded`] };
  }
  let review;
  try {
    review = parseFor(tree, rel, intentId, true);
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    return { rel, review: null, owed: [...owed, error.message] };
  }
  if (review.tree !== proofs.scopeHash(tree)) {
    owed.push(`the code changed since the review read it at ${(review.commit || 'an unknown commit').slice(0, 7)}`);
  } else if (review.verdict !== 'clean') {
    owed.push('the review says fix and its findings are not fixed');
  }
  return { rel, review, owed };
}

/**
 * A runner call printed for the caller to run next. It carries the caller's tree, intent and
 * host config, so run as printed it reads the config the caller's call read and dispatches
 * that host's agents.
 */
function runCall(step, tree, options, args = '') {
  const intent = options.intent ? ` --intent ${options.intent}` : '';
  const config = options.config ? ` --config ${options.config}` : '';
  return `run.cjs ${step} --tree ${tree}${args}${intent}${config}`;
}

const reviewCommand = (tree, options) => runCall('review', tree, options);

/** The scan call for the same tree and host, or its collect. */
function scanCommand(tree, options, collect = false) {
  const plan = options.plan ? ` --only ${options.only || 'wiring'} --plan ${options.plan}` : '';
  return runCall(collect ? 'scan --collect' : 'scan', tree, options, plan);
}

/**
 * The gate's refusal after its fold, or null when the review holds. `before` is HEAD before
 * the fold: when the fold moved the tree, the reviewer reads the base delta from there.
 * `shown` are the lines the gate printed so far.
 */
function gateRefusal(tree, config, intentId, options, before, shown) {
  const state = intentReviewState(tree, config, intentId, options);
  if (state.owed.length === 0) return null;
  const out = [...shown, ...state.owed.map((reason) => `intent review owed: ${reason}`)];
  const moved = lib.git(tree, ['rev-parse', 'HEAD']) !== before;
  if (moved) {
    out.push(`the fold moved the tree from ${lib.git(tree, ['rev-parse', '--short', before])}; the reviewer reads the base delta from there`);
  }
  out.push(`run ${reviewCommand(tree, options)} first, then gate again`);
  return { exit: 3, payload: { ok: false, tree, owed: ['review'], reasons: state.owed, folded: moved }, out };
}

/**
 * Whether an evidence path exists. A path inside the intent's own dir is found wherever the
 * intent lives now: both hosts archive that dir before they merge.
 */
function evidenceExists(tree, intentId, rel) {
  const live = `${lib.SPECS_DIR}/intents/${intentId}/`;
  const archived = `${lib.SPECS_DIR}/archive/intents/${intentId}/`;
  const candidates = [rel];
  if (rel.startsWith(live)) candidates.push(archived + rel.slice(live.length));
  if (rel.startsWith(archived)) candidates.push(live + rel.slice(archived.length));
  return candidates.some((candidate) => fs.existsSync(path.join(tree, candidate)));
}

/**
 * What a merge still owes beyond the command proofs: the review for this tree and the
 * evidence of every external criterion. The smoke lane's proof joins this list when the
 * flow gains one.
 */
function mergeOwed(tree, config, intentId, options = {}) {
  const owed = [];
  const out = [];
  const state = intentReviewState(tree, config, intentId, options);
  if (state.owed.length > 0) {
    owed.push('review');
    out.push(...state.owed.map((reason) => `intent review owed: ${reason}`));
  }
  const missing = state.review
    ? state.review.criteria.filter((entry) => entry.proof === 'external' && !evidenceExists(tree, intentId, entry.evidence))
    : [];
  if (missing.length > 0) {
    owed.push('evidence');
    out.push(...missing.map((entry) => `evidence owed: ${entry.evidence} for ${entry.criterion}`));
  }
  return { owed, out };
}

module.exports = {
  gateRefusal, intentFor, intentItems, intentReviewPath, intentReviewState, mergeOwed, parseFor, reviewCommand, runCall,
  scanCommand, scanOwed, scanPath,
};
