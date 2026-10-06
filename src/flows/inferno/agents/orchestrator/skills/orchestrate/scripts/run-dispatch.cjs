'use strict';

/**
 * Dispatch attribution. `dispatch-log` records a snapshot of the tree immediately before a
 * builder starts, `accept-dispatch` freezes the result the orchestrator accepted, and
 * verify-item attributes every changed path to the dispatch that owns it. Without it a
 * parallel round showed every sibling's uncommitted edit as outside the item under review,
 * and nothing tied a builder's reported files to what it actually changed.
 *
 * One record may cover a serial chain (`--items a,b`): one builder builds the chain in order,
 * so files its items share are no overlap. A correction gets its own record that points at the
 * attempts before it, and the item is judged from the first attempt's baseline with the files
 * of every accepted attempt, so a correction neither has to repeat an earlier attempt's files
 * nor hides an escape that attempt made.
 *
 * Records are signed with a key kept in the user's cache beside them. That makes them tamper
 * evident against accidents (a hand edit, a record carried into another tree, a stale copy),
 * not against a builder that sets out to read the key and forge one.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}

function refuse(message) {
  return new RunError(message, 'DISPATCH_PROOF');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return null;
  }
}

function gitNames(tree, args) {
  const out = execFileSync('git', [...args, '-z'], {
    cwd: tree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\0').filter(Boolean);
}

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

/** One path's identity: a file by content, a link by target, a submodule by its commit. */
function entryOf(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return { kind: 'symlink', hash: hash(fs.readlinkSync(target)), executable: false };
  if (stat.isFile()) {
    const content = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    return { kind: 'file', hash: content, executable: Boolean(stat.mode & 0o111) };
  }
  if (stat.isDirectory()) {
    const head = fs.existsSync(path.join(target, '.git')) ? lib.git(target, ['rev-parse', 'HEAD'], { tolerate: true }) : null;
    return { kind: 'commit', hash: head || null, executable: false };
  }
  throw refuse(`cannot snapshot ${target}: not a file, a link or a submodule`);
}

/** Every tracked and untracked path by identity, so uncommitted builder output is captured too. */
function captureSnapshot(tree) {
  const files = {};
  for (const file of [...new Set(gitNames(tree, ['ls-files', '--cached', '--others', '--exclude-standard']))].sort()) {
    files[file] = entryOf(path.join(tree, file));
  }
  return { version: 1, head_sha: lib.git(tree, ['rev-parse', 'HEAD']), files, digest: hash(files) };
}

const same = (left, right, file) => hash(left.files[file] || null) === hash(right.files[file] || null);

function snapshotDelta(before, after) {
  for (const snapshot of [before, after]) {
    if (!snapshot || snapshot.version !== 1 || !snapshot.files || snapshot.digest !== hash(snapshot.files) ||
        !/^[a-f0-9]{40,64}$/.test(snapshot.head_sha || '')) {
      throw refuse('dispatch baseline or accepted snapshot is missing or changed');
    }
  }
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter((file) => !same(before, after, file))
    .sort();
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

function dispatchDirectory(tree) {
  return path.join(lib.cacheDir(tree), 'dispatch', hash(fs.realpathSync(tree)));
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

/** A record as verification reads it: the first attempt's baseline and every accepted file. */
function effective(tree, record) {
  const members = lineage(tree, record);
  const root = [...members].reverse().find((entry) => !(entry.previous || []).length) || members[members.length - 1];
  const claimed = new Set();
  for (const entry of members) if (entry.phase === 'accepted') for (const file of claimedPaths(entry)) claimed.add(file);
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
    beforeSnapshot: captureSnapshot(tree),
  });
}

/**
 * Freeze the accepted result, checked against the baseline: every reported path changed since
 * this dispatch, or an earlier accepted attempt of the same item already carries it. A second
 * accept with the same list is a no-op and with another list a refusal, never a silent keep.
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
  const snapshot = captureSnapshot(tree);
  const changed = snapshotDelta(record.beforeSnapshot, snapshot);
  const earlier = new Set(effective(tree, record).claimed);
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

/** Dispatches of the same round (same first baseline) whose results were never accepted. */
function openDispatches(tree, record) {
  const own = effective(tree, record);
  return currentRecords(tree)
    .filter((entry) => entry.phase !== 'accepted' && !own.ids.has(entry.dispatchId))
    .filter((entry) => effective(tree, entry).before.head_sha === own.before.head_sha)
    .map((entry) => ({ dispatch_id: entry.dispatchId, items: itemsOf(entry) }));
}

/** Paths that landed in a commit since the baseline and are clean now: a fold or an integration. */
function committedSince(tree, head) {
  if (lib.git(tree, ['rev-parse', 'HEAD']) === head) return new Set();
  const dirty = new Set([...gitNames(tree, ['diff', '--name-only', '--no-renames', 'HEAD']), ...gitNames(tree, ['ls-files', '--others', '--exclude-standard'])]);
  return new Set(gitNames(tree, ['diff', '--name-only', '--no-renames', head, 'HEAD']).filter((file) => !dirty.has(file)));
}

/** A peer explains only its own accepted paths, and only from the same first baseline. */
function explainedByPeers(tree, own, editable, peers, current) {
  const explained = new Set();
  for (const peer of peers) {
    validateDispatch(tree, peer);
    if (own.ids.has(peer.dispatchId)) continue;
    const view = effective(tree, peer);
    if (view.before.head_sha !== own.before.head_sha) continue;
    const peerChanged = snapshotDelta(view.before, peer.acceptedSnapshot);
    for (const file of view.claimed) {
      if (!peerChanged.includes(file) || !lib.ownedBy(file, peer.assignment.ownership.editable, tree)) {
        throw refuse('peer dispatch claims an unverified or unowned path');
      }
      if (!current.changed.includes(file)) continue;
      if (same(peer.acceptedSnapshot, own.before, file)) continue;
      if (!same(view.before, own.before, file)) continue;
      if (own.claimed.includes(file) || lib.ownedBy(file, editable, tree)) {
        throw refuse(`dispatch ownership overlaps at ${file} with dispatch ${peer.dispatchId}: ` +
          'a serial chain one builder builds takes one dispatch-log --items a,b');
      }
      if (same(peer.acceptedSnapshot, current.snapshot, file)) explained.add(file);
    }
  }
  return explained;
}

/**
 * Every path changed since the item's first baseline, sorted into the item's own, `unreported`
 * (owned by the spec and the record, changed, but missing from changed_files) and `outside`.
 * An unreported change that landed in a commit since the baseline is the integration's (a
 * sibling landing, a fold of the base), not the builder's: builders never commit, and every
 * item is committed only after its review.
 */
function verifyDispatch(tree, record, editable, options = {}) {
  validateDispatch(tree, record);
  const own = effective(tree, record);
  for (const entry of own.members.filter((member) => member.phase === 'accepted')) {
    const patch = snapshotDelta(entry.beforeSnapshot, entry.acceptedSnapshot);
    const missing = claimedPaths(entry).filter((file) => !patch.includes(file));
    if (missing.length > 0) throw refuse(`accepted paths have no dispatch patch: ${missing.join(', ')}`);
  }
  const snapshot = captureSnapshot(tree);
  for (const file of own.claimed) {
    if (!same(snapshot, record.acceptedSnapshot, file)) {
      throw refuse(`accepted dispatch bytes changed at ${file}: run dispatch-log before a correction resumes the builder, ` +
        'then accept-dispatch its result');
    }
  }
  const committed = committedSince(tree, own.before.head_sha);
  const changed = [...new Set([...snapshotDelta(own.before, record.acceptedSnapshot), ...snapshotDelta(own.before, snapshot)])]
    .filter((file) => own.claimed.includes(file) || !committed.has(file))
    .sort();
  const current = { snapshot, changed };
  const explained = explainedByPeers(tree, own, editable, options.peers || currentRecords(tree).filter((entry) => entry.phase === 'accepted'), current);
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
  return {
    since: own.before.head_sha,
    head_sha: record.acceptedSnapshot.head_sha,
    dispatch_id: record.dispatchId,
    changed: own.claimed,
    outside,
    unreported,
  };
}

module.exports = {
  acceptDispatch,
  captureSnapshot,
  hash,
  itemsOf,
  loadDispatch,
  openDispatches,
  recordDispatch,
  recordFile,
  snapshotDelta,
  validateDispatch,
  verifyDispatch,
};
