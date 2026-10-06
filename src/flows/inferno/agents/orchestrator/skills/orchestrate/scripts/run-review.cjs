'use strict';

/**
 * `run.cjs review --item`: the cold review every item gets before it lands, and the ladder
 * that says who builds the item next.
 *
 * The order per item: the builder returns, the orchestrator commits the item, this step
 * prints the reviewer dispatch line, the reviewer writes its file, and the same step
 * validates, records and commits that file. A clean review lets `integrate --item` land the
 * item. A fix review goes back to the builder the ladder names, and the next review reads
 * only what changed since.
 *
 * The review binds the files it lists, never the whole tree: items build in parallel in one
 * worktree, and another item's commit must not void this one's review.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const writer = require('./state-transition.cjs');
const { parseItemReview, reviewPath } = require('./run-review-file.cjs');
const { REINSTALL, completedBeforeReviewRule, reviewRuleSince } = require('./state-review.cjs');

const { RunError } = lib;

const REVIEWER = 'specsmd-inferno-reviewer';
const AGENTS = {
  cheap: 'specsmd-inferno-builder-cheap',
  strong: 'specsmd-inferno-builder',
  escalate: 'specsmd-inferno-builder-escalate',
  oracle: 'specsmd-inferno-oracle',
};
/** The `roles` entry a host config (Codex) names each actor under. */
const ROLES = { cheap: 'builder_cheap', strong: 'builder_strong', escalate: 'builder_escalate', oracle: 'oracle' };

/** The tier that builds an item first. Complexity alone decides it. */
function tierOf(item) {
  return item.complexity === 'low' ? 'cheap' : 'strong';
}

/**
 * Who acts on the item next. Cheap rejected once goes to a fresh strong builder, strong
 * rejected twice to a fresh escalate builder, and every two rejections on the escalate
 * builder go to the oracle, whose decision returns to that warm builder as a correction.
 * The count is per tier, recorded by state-review.cjs.
 */
function nextActor(item) {
  const tier = item.review_tier || tierOf(item);
  const rejections = Number(item.review_rejections) || 0;
  let actor = tier;
  let fresh = false;
  if (tier === 'cheap' && rejections >= 1) [actor, fresh] = ['strong', true];
  else if (tier === 'strong' && rejections >= 2) [actor, fresh] = ['escalate', true];
  else if (tier === 'escalate' && rejections >= 2 && rejections % 2 === 0) actor = 'oracle';
  return { actor, agent: AGENTS[actor], fresh, rejections };
}

/** The tier that built the version a review read: the oracle decides, the escalate builder builds. */
function builtBy(item) {
  const { actor } = nextActor(item);
  return actor === 'oracle' ? 'escalate' : actor;
}

/**
 * The agent and model this host dispatches for an actor: `models.<tier>` and the Claude agent
 * names by default, or the host's `roles.<role>` entry where its config names one.
 */
function hostActor(actor, config = {}) {
  const roles = config.roles && typeof config.roles === 'object' ? config.roles : {};
  const role = roles[ROLES[actor]] && typeof roles[ROLES[actor]] === 'object' ? roles[ROLES[actor]] : {};
  const agent = typeof role.agent === 'string' && role.agent ? role.agent : AGENTS[actor];
  const model = (config.models && config.models[actor]) || (typeof role.model === 'string' && role.model) || null;
  return { agent, model };
}

/** The actor with the model the host names for it, as frontier and review print it. */
function actorLabel(item, config) {
  const { actor } = nextActor(item);
  const { model } = hostActor(actor, config);
  return model ? `${actor} ${model}` : actor;
}

/** The one line frontier and review both print for a rejected item. */
function nextLine(id, item, config) {
  const next = nextActor(item);
  const label = `${actorLabel(item, config)} ${hostActor(next.actor, config).agent}`;
  const loop = 'then commit and run review again';
  if (next.actor === 'oracle') {
    return `next ${label}: ask it about ${id} with every finding so far; its decision goes to the warm escalate builder as a correction, ${loop}`;
  }
  if (next.fresh) return `next ${label}: a fresh builder takes ${id} over with every finding so far, ${loop}`;
  return `next ${label}: send every finding to the warm builder of ${id} as one correction, ${loop}`;
}

function itemOf(ledger, id, options) {
  const intent = options.intent
    ? lib.findIntent(ledger, options.intent)
    : ledger.intents.find((entry) => entry.items.some((item) => item.id === id));
  const item = intent && intent.items.find((entry) => entry.id === id);
  if (!item) throw new RunError(`work item not found in the live ledger: ${id}`, 'ITEM_NOT_FOUND');
  return { intent, item };
}

const filesHash = (tree, files) => proofs.scopeHash(tree, files, { exact: true });
const short = (tree, ref) => lib.git(tree, ['rev-parse', '--short', ref]);

/** Where the item's work starts: the merge base with the base branch. */
function forkPoint(tree, config, intent) {
  // Required here, not at the top: run-intents loads run-frontier, which loads this file.
  const { resolveBase } = require('./run-intents.cjs');
  const base = resolveBase(config, intent, tree);
  return lib.git(tree, ['merge-base', 'HEAD', base], { tolerate: true }) || 'HEAD';
}

function owed(tree, context, reason, from, paths) {
  const { intent, item, config, rel } = context;
  const model = config.review && config.review.model;
  const range = `${short(tree, from)}..${short(tree, 'HEAD')}`;
  const spec = path.relative(tree, lib.readItemSpec(tree, intent.id, item.id).file);
  const brief = path.join(lib.SPECS_DIR, 'intents', intent.id, 'brief.md');
  return {
    exit: 3,
    payload: { ok: false, item: item.id, owed: reason, agent: REVIEWER, model: model || null, range, paths, spec, brief, write: rel },
    out: [
      `review owed for ${item.id}: ${reason}`,
      `dispatch ${REVIEWER}${model ? ` model ${model}` : ''} item ${item.id}`,
      `  range ${range} paths ${paths.join(' ') || '(the whole range)'}`,
      `  spec ${spec}`,
      `  brief ${brief}`,
      `  write ${rel}`,
      `then run.cjs review --item ${item.id} --tree ${tree} records it`,
    ],
  };
}

function verdictResult(tree, context, review, head) {
  const { item, config } = context;
  const out = [head];
  if (review.verdict === 'clean') {
    out.push(`then run.cjs integrate --item ${item.id} --tree ${tree}`);
    return { exit: 0, payload: { ok: true, item: item.id, verdict: 'clean' }, out };
  }
  for (const finding of review.findings) {
    out.push(`FINDING ${finding.criterion} ${finding.file}:${finding.line}: ${finding.evidence}. fix: ${finding.fix}`);
  }
  for (const mutant of review.survivors) out.push(`MUTANT ${mutant.criterion} survived: ${mutant.test}`);
  const next = nextActor(item);
  out.push(nextLine(item.id, item, config));
  return {
    exit: 2,
    payload: { ok: false, item: item.id, verdict: 'fix', findings: review.findings, survivors: review.survivors, next },
    out,
  };
}

function record(tree, context, ledger) {
  const { intent, item, rel } = context;
  const review = parseItemReview(tree, rel, item.id, { recorded: false });
  const commit = lib.git(tree, ['rev-parse', 'HEAD']);
  const hash = filesHash(tree, review.files);
  const result = writer.reviewItem({
    file: ledger.file, intent: intent.id, item: item.id, verdict: review.verdict,
    files_hash: hash, tier: builtBy(item), commit,
  });
  const abs = path.join(tree, rel);
  const text = fs.readFileSync(abs, 'utf8');
  fs.appendFileSync(abs, `${text.endsWith('\n') ? '' : '\n'}tree: ${hash}\ncommit: ${commit}\n`);
  const paths = [path.join(lib.SPECS_DIR, 'state.yaml'), rel];
  lib.git(tree, ['add', '--', ...paths]);
  lib.git(tree, ['commit', '-q', '-m', `specsmd(${intent.id}): review ${item.id} ${review.verdict}`, '--', ...paths]);
  const updated = itemOf(lib.readLedger(tree), item.id, { intent: intent.id }).item;
  const head = `review ${item.id} ${review.verdict}, recorded at ${short(tree, commit)} ` +
    `(${result.tier}, ${result.rejections} rejection(s))`;
  return verdictResult(tree, { ...context, item: updated }, review, head);
}

/** The step itself: dispatch line when owed, record when written, the verdict when current. */
function review(options) {
  if (!options.item) {
    throw new RunError('usage: node run.cjs review --item <id> --tree <dir> [--intent <id>]', 'BAD_ARGS', 1);
  }
  const tree = options.tree || lib.repoRoot(options.cwd);
  const ledger = lib.readLedger(tree);
  const { intent, item } = itemOf(ledger, options.item, options);
  const rel = reviewPath(intent.id, item.id);
  const config = lib.readConfig(tree, options.config);
  const context = { intent, item, config, rel };
  const manifest = lib.readItemSpec(tree, intent.id, item.id).manifest || {};
  const editable = (manifest.ownership && manifest.ownership.editable) || [];

  const exists = fs.existsSync(path.join(tree, rel));
  const pending = exists && lib.gitLines(tree, ['status', '--porcelain', '--', rel]).length > 0;
  const current = exists && !pending ? parseItemReview(tree, rel, item.id, { recorded: true }) : null;

  // Only this item's work has to be committed: another builder may be editing beside it.
  const listed = current ? current.files : [];
  const dirty = lib.dirtyPaths(tree).filter((file) => lib.ownedBy(file, editable) || listed.includes(file));
  if (dirty.length > 0) {
    throw new RunError(
      `refusing to review ${item.id} over uncommitted work in ${dirty.slice(0, 5).join(', ')}: ` +
        'commit the item first, then run this command again.',
      'DIRTY'
    );
  }

  if (!exists) return owed(tree, context, 'no review yet', forkPoint(tree, config, intent), editable);
  if (pending) return record(tree, context, ledger);
  // A fix review is owed again by any commit on the item's own paths, not only on the files
  // it listed: the usual answer to "this criterion has no test" is a new file.
  const touched = item.review === 'fix' && item.review_commit
    ? lib.gitLines(tree, ['diff', '--name-only', `${item.review_commit}..HEAD`], { tolerate: true })
      .filter((file) => lib.ownedBy(file, editable) || current.files.includes(file))
    : [];
  if (item.review && item.review_hash === filesHash(tree, current.files) && touched.length === 0) {
    const head = `review ${item.id} ${current.verdict} for the current files (read at ${short(tree, item.review_commit)})`;
    return verdictResult(tree, context, current, head);
  }
  const paths = [...new Set([...current.files, ...touched])];
  return owed(tree, context, 'the item changed since the last review', item.review_commit || forkPoint(tree, config, intent), paths);
}

/**
 * The items of one landing whose review is not clean for their files as they stand. integrate
 * checks every id with this before it folds or writes anything.
 */
function owedReviews(tree, ledger, ids, options) {
  const lines = [];
  const since = reviewRuleSince(tree);
  for (const id of ids) {
    const { intent, item } = itemOf(ledger, id, options);
    const complete = writer.isComplete(item.status);
    if (complete && completedBeforeReviewRule(item.completed_at, since)) continue;
    const command = `run.cjs review --item ${id} --tree ${tree}${complete && since === null ? `. ${REINSTALL}` : ''}`;
    if (item.review !== 'clean') {
      lines.push(`${id} ${item.review === 'fix' ? 'has a fix review' : 'has no clean review'}, run ${command}`);
      continue;
    }
    let reviewed;
    try {
      reviewed = parseItemReview(tree, reviewPath(intent.id, id), id, { recorded: true });
    } catch (error) {
      lines.push(`${id} has no readable review file, run ${command}`);
      continue;
    }
    if (filesHash(tree, reviewed.files) !== item.review_hash) {
      lines.push(`${id}: a file it lists changed since its review, run ${command}`);
    }
  }
  return lines;
}

module.exports = { actorLabel, hostActor, nextActor, nextLine, owedReviews, review, tierOf };
