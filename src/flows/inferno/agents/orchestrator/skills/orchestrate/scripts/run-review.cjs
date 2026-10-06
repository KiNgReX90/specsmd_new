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
const { afterRecovery, recoverInterrupted } = require('./run-mutate.cjs');
const { parseItemReview, reviewPath } = require('./run-review-file.cjs');
const { REINSTALL, completedBeforeReviewRule, reviewRuleSince } = require('./state-review.cjs');

const { RunError } = lib;

/**
 * The key of each actor's `roles` entry on each host: the one the installer renders that
 * role's pins from. The host dispatches the agent the key names, `specsmd-inferno-<key>` on
 * Claude and `specsmd_inferno_<key>` on Codex, the agents the flow's own files define. The
 * reviewer's and the scanner's agents arrive with their roles.
 */
const ROLES = {
  claude: {
    cheap: 'builder-cheap', strong: 'builder', escalate: 'builder-escalate', oracle: 'oracle', reviewer: 'reviewer', scanner: 'scanner',
  },
  codex: {
    cheap: 'builder_cheap', strong: 'builder_strong', escalate: 'builder_escalate', oracle: 'oracle', reviewer: 'reviewer', scanner: 'scanner',
  },
};

/** The config key that pins an actor's model on Claude ahead of its role entry. */
const PINS = { reviewer: (config) => config.review && config.review.model, scanner: (config) => config.scan && config.scan.model };

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
function nextActor(item, config = {}) {
  const tier = item.review_tier || tierOf(item);
  const rejections = Number(item.review_rejections) || 0;
  let actor = tier;
  let fresh = false;
  if (tier === 'cheap' && rejections >= 1) [actor, fresh] = ['strong', true];
  else if (tier === 'strong' && rejections >= 2) [actor, fresh] = ['escalate', true];
  else if (tier === 'escalate' && rejections >= 2 && rejections % 2 === 0) actor = 'oracle';
  return { actor, agent: hostActor(actor, config).agent, fresh, rejections };
}

/** The tier that built the version a review read: the oracle decides, the escalate builder builds. */
function builtBy(item) {
  const { actor } = nextActor(item);
  return actor === 'oracle' ? 'escalate' : actor;
}

/**
 * The agent and model this host dispatches for an actor. The agent is always the host's own
 * for that role, since the installer pins the role's model on exactly that agent. On Codex the
 * model is the role entry's alone, because the spawned agent's pin wins. On Claude it is
 * `models.<tier>`, `review.model` for the reviewer or `scan.model` for the scanner, before the
 * role entry's.
 */
function hostActor(actor, config = {}) {
  const host = config.host === 'codex' ? 'codex' : 'claude';
  const key = ROLES[host][actor];
  const roles = config.roles && typeof config.roles === 'object' ? config.roles : {};
  const role = roles[key] && typeof roles[key] === 'object' ? roles[key] : {};
  const roleModel = (typeof role.model === 'string' && role.model) || null;
  if (host === 'codex') return { agent: `specsmd_inferno_${key}`, model: roleModel };
  const pinned = PINS[actor] ? PINS[actor](config) : config.models && config.models[actor];
  return { agent: `specsmd-inferno-${key}`, model: pinned || roleModel };
}

/** The actor with the model the host names for it, as frontier and review print it. */
function actorLabel(item, config) {
  const { actor } = nextActor(item);
  const { model } = hostActor(actor, config);
  return model ? `${actor} ${model}` : actor;
}

/** The one line frontier and review both print for a rejected item. */
function nextLine(id, item, config) {
  const next = nextActor(item, config);
  const label = `${actorLabel(item, config)} ${next.agent}`;
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
  const { agent, model } = hostActor('reviewer', config);
  const range = `${short(tree, from)}..${short(tree, 'HEAD')}`;
  const spec = path.relative(tree, lib.readItemSpec(tree, intent.id, item.id).file);
  const brief = path.join(lib.SPECS_DIR, 'intents', intent.id, 'brief.md');
  return {
    exit: 3,
    payload: { ok: false, item: item.id, owed: reason, agent, model, range, paths, spec, brief, write: rel },
    out: [
      `review owed for ${item.id}: ${reason}`,
      `dispatch ${agent}${model ? ` model ${model}` : ''} item ${item.id}`,
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
  const next = nextActor(item, config);
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

/** The files a pending review lists. A review that does not parse lists none here; its record reports why. */
function pendingFiles(tree, rel, id) {
  try {
    return parseItemReview(tree, rel, id, { recorded: false }).files;
  } catch (error) {
    if (error instanceof RunError) return [];
    throw error;
  }
}

/** The step itself. Every call first puts back a killed mutate's leftover and refuses this item's uncommitted work. */
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

  // Only this item's work has to be committed: another builder may be editing beside it, and
  // another item's reviewer may be running a mutant beside it. A dead run's mutant goes back
  // first, so it never reads as this item's work. A pending review binds every file it lists.
  const listed = pending ? pendingFiles(tree, rel, item.id) : current ? current.files : [];
  const mine = (file) => lib.ownedBy(file, editable) || listed.includes(file);
  const restored = recoverInterrupted(tree, { keepLive: (file) => !mine(file) });
  const dirty = lib.dirtyPaths(tree).filter(mine);
  if (dirty.length > 0) {
    throw new RunError(afterRecovery(restored,
      `refusing to review ${item.id} over uncommitted work in ${dirty.slice(0, 5).join(', ')}: ` +
        'commit the item first, then run this command again.'), 'DIRTY');
  }

  const result = step(tree, context, { ledger, editable, exists, pending, current });
  return { ...result, out: [...restored, ...result.out] };
}

/** Dispatch line when no review exists, record when one is written, the verdict when current. */
function step(tree, context, { ledger, editable, exists, pending, current }) {
  const { intent, item, config } = context;
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
