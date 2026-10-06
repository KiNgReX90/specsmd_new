'use strict';

/**
 * verify-item's attribution: which dispatch record answers for each reviewed item, and what
 * changed since its baseline inside and outside the item's ownership. The records live in
 * run-dispatch.cjs, and which changes a sibling's patches explain in run-peers.cjs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = require('./run-lib.cjs');
const dispatch = require('./run-dispatch.cjs');
const { explainedByPeers, startsFrom } = require('./run-peers.cjs');

const { RunError } = lib;
const refuse = dispatch.refuse;

/** Dispatches started at or after this item's first baseline whose results were never accepted. */
function openDispatches(tree, own) {
  return dispatch.currentRecords(tree)
    .filter((entry) => entry.phase !== 'accepted' && !own.ids.has(entry.dispatchId))
    .filter((entry) => startsFrom(tree, own.before.head_sha, entry.beforeSnapshot.head_sha))
    .map((entry) => ({ dispatch_id: entry.dispatchId, items: dispatch.itemsOf(entry) }));
}

function gitNames(tree, args) {
  return (lib.git(tree, [...args, '-z']) || '').split('\0').filter(Boolean);
}

/**
 * Paths the fold of `base` brought in since the baseline at `head` and nothing changed since:
 * what the base changed after the last base commit the baseline held, merged or fast-forwarded.
 * On the base branch itself nothing is a fold.
 */
function foldedSince(tree, head, base) {
  if (!base || lib.currentBranch(tree) === base) return new Set();
  const dirty = new Set([...gitNames(tree, ['diff', '--name-only', '--no-renames', 'HEAD']), ...gitNames(tree, ['ls-files', '--others', '--exclude-standard'])]);
  const folded = new Set();
  for (const ref of [base, `origin/${base}`]) {
    const tip = lib.git(tree, ['merge-base', 'HEAD', ref], { tolerate: true });
    const held = tip && lib.git(tree, ['merge-base', head, tip], { tolerate: true });
    if (!held || held === tip) continue;
    for (const file of gitNames(tree, ['diff', '--name-only', '--no-renames', held, tip])) if (!dirty.has(file)) folded.add(file);
  }
  return folded;
}

/**
 * Paths `info/exclude` hides now that are new or changed since the baseline and that a
 * `.gitignore` or the user's global ignore file does not hide anyway. Another worktree's line
 * that hides nothing new here is no refusal.
 */
function newlyHidden(tree, before, now) {
  const exposed = Object.keys(now.hidden).filter((file) => dispatch.hash(dispatch.entryIn(before, file)) !== dispatch.hash(now.hidden[file]));
  if (exposed.length === 0) return [];
  const global = lib.git(tree, ['config', '--path', '--get', 'core.excludesFile'], { tolerate: true }) ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'git', 'ignore');
  const sources = ['--exclude-per-directory=.gitignore', ...(fs.existsSync(global) ? [`--exclude-from=${global}`] : [])];
  const anyway = new Set(gitNames(tree, ['ls-files', '--others', '--ignored', '--directory', ...sources, '--', ...exposed]));
  return exposed.filter((file) => !anyway.has(file));
}

/**
 * Every path changed since the item's first baseline, sorted into the item's own, `unreported`
 * (owned by the spec and the record, changed, but missing from changed_files) and `outside`. A
 * path the fold of `options.base` brought in is the base's. Any other commit since the baseline,
 * a sibling's landing or a builder's own, is attributed like an uncommitted change.
 */
function verifyDispatch(tree, record, editable, options = {}) {
  dispatch.validateDispatch(tree, record);
  const own = dispatch.effective(tree, record);
  for (const entry of own.members.filter((member) => member.phase === 'accepted')) {
    const patch = dispatch.snapshotDelta(entry.beforeSnapshot, entry.acceptedSnapshot);
    const missing = dispatch.claimedPaths(entry).filter((file) => !patch.includes(file));
    if (missing.length > 0) throw refuse(`accepted paths have no dispatch patch: ${missing.join(', ')}`);
  }
  const snapshot = dispatch.captureSnapshot(tree);
  const hidden = newlyHidden(tree, own.before, snapshot);
  if (hidden.length > 0) {
    throw refuse(`${dispatch.excludeFile(tree)} hides ${hidden.slice(0, 5).join(', ')}, new or changed since the dispatch baseline: ` +
      'make it visible to git, then verify again');
  }
  for (const file of own.claimed) {
    if (!dispatch.same(snapshot, record.acceptedSnapshot, file)) {
      throw refuse(`accepted dispatch bytes changed at ${file}: run dispatch-log before a correction resumes the builder, ` +
        'then accept-dispatch its result');
    }
  }
  const folded = foldedSince(tree, own.before.head_sha, options.base);
  const changed = [...new Set([...dispatch.snapshotDelta(own.before, record.acceptedSnapshot), ...dispatch.snapshotDelta(own.before, snapshot)])]
    .filter((file) => own.claimed.includes(file) || !folded.has(file))
    .sort();
  const peers = options.peers || dispatch.currentRecords(tree).filter((entry) => entry.phase === 'accepted');
  const explained = explainedByPeers(tree, own, editable, peers, { snapshot, changed });
  const owned = (file) => lib.ownedBy(file, editable, tree) && lib.ownedBy(file, record.assignment.ownership.editable, tree);
  const outside = [];
  const unreported = [];
  for (const file of changed) {
    if (own.claimed.includes(file)) {
      if (!owned(file)) outside.push(file);
    } else if (!explained.has(file)) {
      (owned(file) ? unreported : outside).push(file);
    }
  }
  return { since: own.before.head_sha, head_sha: record.acceptedSnapshot.head_sha, dispatch_id: record.dispatchId, changed: own.claimed, outside, unreported };
}

/** The dispatch records verify-item may consult as peers: every accepted one, or `--peers`. */
function peerRecords(tree, peers) {
  if (peers === undefined) return undefined;
  let ids = peers;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch (error) {
      ids = null;
    }
  }
  if (!Array.isArray(ids)) throw new RunError('verify-item --peers requires a JSON array of dispatch ids', 'BAD_ARGS', 1);
  return ids.map((id) => dispatch.loadDispatch(tree, { dispatch_id: id }));
}

/**
 * The dispatch ids the log holds for this item, `null` for a line the runner before signed
 * records wrote: its six fields end before the seventh, the dispatch id, this runner adds.
 */
function loggedDispatches(tree, intent, item) {
  const log = path.join(lib.cacheDir(tree), 'dispatch', `${intent}.log`);
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').map((line) => line.split('\t'))
    .filter((fields) => fields[1] === intent && fields[2] === item)
    .map((fields) => fields[6] || null);
}

function editableOf(tree, intent, ids) {
  const owned = new Set();
  for (const id of ids) {
    const spec = lib.readItemSpec(tree, intent, id);
    for (const entry of (spec.manifest.ownership && spec.manifest.ownership.editable) || []) owned.add(entry);
  }
  return [...owned];
}

/**
 * The record that answers for an item. An item only the runner before signed records dispatched
 * is checked the old way (`null`), so an intent in flight when the runner was updated still
 * lands. A dispatch this runner logged is never checked the old way when its record is missing.
 */
function recordFor(tree, entry, options) {
  try {
    return dispatch.loadDispatch(tree, { intent: entry.intent, item: entry.id, dispatch_id: options.dispatch_id });
  } catch (error) {
    if (!(error instanceof RunError) || !/^no dispatch recorded/.test(error.message) || options.dispatch_id) throw error;
    const logged = loggedDispatches(tree, entry.intent, entry.id);
    const signed = logged.find(Boolean);
    if (signed) {
      throw new RunError(`dispatch ${signed} for ${entry.id} was logged, but ${fs.realpathSync(tree)} has no record of it: pass the ` +
        `--tree its dispatch-log used, or name a baseline with --since if the record left the cache (${lib.cacheDir(tree)})`, 'DISPATCH_PROOF');
    }
    if (logged.length > 0) return null;
    throw error;
  }
}

/**
 * Each reviewed item against the record of the builder that built it, a chain's items against
 * their one shared record, with `options.base` the branch whose fold is excused. Returns `legacy`
 * instead when an item predates signed records. The ledger is the single writer's and never a
 * builder's, so it is never outside.
 */
function attribute(tree, items, options) {
  if (options.dispatch_id && items.length > 1) {
    throw new RunError('--dispatch-id names one item; a batch is checked against each item\'s latest dispatch', 'BAD_ARGS', 1);
  }
  const records = new Map();
  const legacy = [];
  for (const entry of items) {
    const record = recordFor(tree, entry, options);
    if (record) records.set(record.dispatchId, record);
    else legacy.push(entry.id);
  }
  if (legacy.length > 0) return { legacy };

  const peers = peerRecords(tree, options.peers);
  const ledger = (file) => file.startsWith(`${lib.SPECS_DIR}/`);
  const outside = new Set();
  const unreported = new Set();
  const attributed = [];
  for (const record of records.values()) {
    const open = openDispatches(tree, dispatch.effective(tree, record));
    if (open.length > 0) {
      throw new RunError(`dispatch ${open[0].dispatch_id} for ${open[0].items.join(', ')} is still open: run accept-dispatch ` +
        'on every result started since this item\'s baseline, a blocked one with its changed_files as they are, before verify-item', 'DISPATCH_PROOF');
    }
    const ids = dispatch.itemsOf(record);
    const result = verifyDispatch(tree, record, editableOf(tree, record.assignment.intent, ids), { peers, base: options.base });
    for (const file of result.outside) if (!ledger(file)) outside.add(file);
    for (const file of result.unreported) if (!ledger(file)) unreported.add(file);
    attributed.push({ items: ids, dispatch_id: result.dispatch_id, since: result.since, changed: result.changed });
  }
  return { since: attributed[0].since, outside: [...outside].sort(), unreported: [...unreported].sort(), attributed };
}

module.exports = { attribute, verifyDispatch };
