'use strict';

/**
 * Dispatch records. `dispatch-log` records a snapshot of the tree immediately before a builder
 * starts, and `accept-dispatch` freezes the result the orchestrator accepted. verify-item
 * attributes every changed path against them (run-attribute.cjs, run-peers.cjs), and the
 * snapshots are taken in run-snapshot.cjs. Without them a parallel round showed every sibling's
 * uncommitted edit as outside the item under review, and nothing tied a builder's reported files
 * to what it actually changed.
 *
 * One record may cover a serial chain (`--items a,b`): one builder builds the chain in order,
 * so files its items share are no overlap. A correction or a re-dispatch gets its own record that
 * points at the attempts before it, accepted or not, and the item is judged from the first
 * attempt's baseline, so the next attempt may report what an earlier one changed and never hides
 * an escape that attempt made.
 *
 * Records are signed with a key kept in the user's cache beside them. That makes them tamper
 * evident against accidents (a hand edit, a record carried into another tree, a stale copy),
 * not against a builder that sets out to read the key and forge one.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const lib = require('./run-lib.cjs');
const snapshots = require('./run-snapshot.cjs');

const { dispatchDirectory, hash, readJson, refuse, sequencedSnapshot, snapshotDelta, stable } = snapshots;

function key(tree, create = false) {
  const file = path.join(lib.cacheDir(tree), 'proof-key');
  if (create) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  try {
    return fs.readFileSync(file);
  } catch (error) {
    return null;
  }
}

function signature(body, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(stable(body))).digest('hex');
}

function exactPaths(paths) {
  const exact = (file) => typeof file === 'string' && !path.posix.isAbsolute(file) &&
    path.posix.normalize(file) === file && !file.startsWith('../') && !file.includes('\\');
  if (!Array.isArray(paths) || !paths.every(exact)) throw refuse('accepted dispatch needs exact relative changed paths');
  return [...new Set(paths)].sort();
}

function claimedPaths(record) {
  return exactPaths(record.completion && record.completion.filesModified);
}

function recordFile(tree, id) {
  return path.join(dispatchDirectory(tree), `${hash(id)}.json`);
}
function currentFile(tree, intent, item) {
  return path.join(dispatchDirectory(tree), `current-${hash([intent, item])}.json`);
}
const itemsOf = (record) => record.assignment.items;

function saveDispatch(tree, record) {
  const body = { ...record };
  delete body.signature;
  const signed = { ...body, signature: signature(body, key(tree, true)) };
  const files = [recordFile(tree, record.dispatchId), ...itemsOf(record).map((item) => currentFile(tree, record.assignment.intent, item))];
  for (const file of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const pending = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(pending, `${JSON.stringify(signed)}\n`, { mode: 0o600 });
    fs.renameSync(pending, file);
  }
  return signed;
}

function validateSigned(tree, record) {
  const secret = key(tree);
  const { signature: signed, ...body } = record || {};
  if (!secret || signed !== signature(body, secret) || record.version !== 2 ||
      record.tree !== fs.realpathSync(tree) || !record.dispatchId) {
    throw refuse('dispatch snapshot signature or tree identity is invalid');
  }
  return record;
}

function isCurrent(tree, record) {
  return itemsOf(record).every((item) => {
    const current = readJson(currentFile(tree, record.assignment.intent, item));
    return Boolean(current) && current.dispatchId === record.dispatchId;
  });
}

function validateDispatch(tree, record, expected = {}, accepted = true) {
  validateSigned(tree, record);
  if (expected.intent && record.assignment.intent !== expected.intent) throw refuse('dispatch snapshot belongs to another intent');
  if (expected.item && !itemsOf(record).includes(expected.item)) throw refuse('dispatch snapshot belongs to another item');
  if (!isCurrent(tree, record)) throw refuse('dispatch was superseded by a newer item attempt');
  if (accepted && record.phase !== 'accepted') throw refuse('item verification needs an accepted dispatch snapshot');
  return record;
}

/** The attempts behind a record, itself first and the first attempt last. */
function lineage(tree, record) {
  const seen = new Map();
  const queue = [record];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (seen.has(entry.dispatchId)) continue;
    seen.set(entry.dispatchId, validateSigned(tree, entry));
    for (const id of entry.previous || []) {
      const prior = readJson(recordFile(tree, id));
      if (!prior) throw refuse(`earlier dispatch ${id} of ${itemsOf(record).join(', ')} is missing from the cache`);
      queue.push(prior);
    }
  }
  return [...seen.values()];
}

/** A record as verification reads it: the first attempt's baseline and every accepted or carried file. */
function effective(tree, record) {
  const members = lineage(tree, record);
  const root = [...members].reverse().find((entry) => !(entry.previous || []).length) || members[members.length - 1];
  const claimed = new Set();
  for (const entry of members.filter((member) => member.phase === 'accepted')) {
    for (const file of [...claimedPaths(entry), ...exactPaths(entry.completion.carried || [])]) claimed.add(file);
  }
  return { record, members, ids: new Set(members.map((entry) => entry.dispatchId)), before: root.beforeSnapshot, claimed: [...claimed].sort() };
}

/** The orchestrator captures this immediately before it launches the builder of an item or a chain. */
function recordDispatch(tree, options) {
  const id = options.dispatch_id;
  const items = options.items || (options.item ? [options.item] : []);
  if (!id || !options.intent || items.length === 0 || !Array.isArray(options.editable)) {
    throw refuse('dispatch baseline needs intent, item, dispatch_id and editable paths');
  }
  const prior = readJson(recordFile(tree, id));
  if (prior) {
    validateDispatch(tree, prior, { intent: options.intent }, false);
    if (hash([itemsOf(prior), prior.assignment.ownership.editable]) !== hash([items, options.editable])) {
      throw refuse('dispatch ownership is immutable');
    }
    return prior;
  }
  const previous = new Set();
  for (const item of items) {
    const current = readJson(currentFile(tree, options.intent, item));
    if (current) previous.add(validateSigned(tree, current).dispatchId);
  }
  return saveDispatch(tree, {
    version: 2,
    tree: fs.realpathSync(tree),
    dispatchId: id,
    phase: 'started',
    assignment: { intent: options.intent, items, ownership: { editable: options.editable } },
    previous: [...previous].sort(),
    beforeSnapshot: sequencedSnapshot(tree),
  });
}

/**
 * The items a dispatch-log for `items` covers: every item their current records cover, to a
 * fixpoint, so a correction of one item of a chain is logged for the whole chain.
 */
function coveredItems(tree, intent, items) {
  const covered = [...items];
  for (let index = 0; index < covered.length; index += 1) {
    const current = readJson(currentFile(tree, intent, covered[index]));
    for (const item of current ? itemsOf(current) : []) if (!covered.includes(item)) covered.push(item);
  }
  return covered;
}

/**
 * Freeze the accepted result, checked against the baseline: every reported path changed since
 * this dispatch, or since the item's first attempt, accepted or not, which this one carries. A
 * second accept with the same list is a no-op and with another list a refusal, never a silent keep.
 */
function acceptDispatch(tree, options) {
  const record = readJson(recordFile(tree, options.dispatch_id));
  if (!record) {
    throw refuse(`no dispatch ${options.dispatch_id} recorded for ${fs.realpathSync(tree)}: pass the --tree its dispatch-log used`);
  }
  validateDispatch(tree, record, {}, false);
  const reported = exactPaths(options.changed_paths);
  if (record.phase === 'accepted') {
    if (hash(record.completion.reported) === hash(reported)) return record;
    throw refuse(`dispatch ${record.dispatchId} is already accepted with ${record.completion.reported.join(', ') || 'no paths'}: ` +
      'a correction takes a fresh dispatch-log');
  }
  const snapshot = sequencedSnapshot(tree);
  const changed = snapshotDelta(record.beforeSnapshot, snapshot);
  const view = effective(tree, record);
  const earlier = new Set([...view.claimed, ...snapshotDelta(view.before, snapshot)]);
  const claim = reported.filter((file) => changed.includes(file));
  const carried = reported.filter((file) => !changed.includes(file) && earlier.has(file));
  const missing = reported.filter((file) => !changed.includes(file) && !earlier.has(file));
  if (missing.length > 0) throw refuse(`accepted paths have no dispatch patch: ${missing.join(', ')}`);
  return saveDispatch(tree, {
    ...record,
    phase: 'accepted',
    completion: { filesModified: claim, carried, reported },
    acceptedSnapshot: snapshot,
  });
}

function loadDispatch(tree, options) {
  const file = options.dispatch_id ? recordFile(tree, options.dispatch_id) : currentFile(tree, options.intent, options.item);
  const record = options.snapshot || readJson(file);
  if (!record) {
    throw refuse(`no dispatch recorded for ${options.dispatch_id || options.item}: run dispatch-log before the builder ` +
      'starts and accept-dispatch on its result, or name a baseline with --since');
  }
  return validateDispatch(tree, record, options);
}

/** Every current record of this tree, one per dispatch. */
function currentRecords(tree) {
  const directory = dispatchDirectory(tree);
  if (!fs.existsSync(directory)) return [];
  const records = new Map();
  for (const name of fs.readdirSync(directory).filter((file) => /^current-[a-f0-9]{64}\.json$/.test(file))) {
    const record = readJson(path.join(directory, name));
    if (record && !records.has(record.dispatchId)) records.set(record.dispatchId, record);
  }
  return [...records.values()].filter((record) => isCurrent(tree, record));
}

module.exports = {
  ...snapshots,
  acceptDispatch,
  claimedPaths,
  coveredItems,
  currentRecords,
  effective,
  itemsOf,
  lineage,
  loadDispatch,
  recordDispatch,
  recordFile,
  validateDispatch,
};
