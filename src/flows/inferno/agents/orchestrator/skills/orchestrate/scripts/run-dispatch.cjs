'use strict';

/**
 * Dispatch attribution. `dispatch-log` records a signed snapshot of the tree immediately before
 * a builder starts, `accept-dispatch` freezes the result the orchestrator accepted, and
 * verify-item attributes every changed path to the dispatch that owns it. Without it a
 * parallel round showed every sibling's uncommitted edit as outside the item under review,
 * and nothing tied a builder's reported files to what it actually changed.
 *
 * Records live in the cache, signed with a key kept beside them, so a record edited by hand or
 * carried over from another tree is refused rather than believed.
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

/** Every tracked and untracked file by content, so uncommitted builder output is captured too. */
function captureSnapshot(tree) {
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: tree,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const files = {};
  for (const file of [...new Set(listing.split('\0').filter(Boolean))].sort()) {
    const target = path.join(tree, file);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      files[file] = null;
      continue;
    }
    if (stat.isSymbolicLink()) files[file] = { kind: 'symlink', hash: hash(fs.readlinkSync(target)), executable: false };
    else if (stat.isFile()) {
      const content = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      files[file] = { kind: 'file', hash: content, executable: Boolean(stat.mode & 0o111) };
    } else throw refuse(`cannot snapshot non-file input: ${file}`);
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

function claimedPaths(record) {
  const paths = record.completion && record.completion.filesModified;
  const exact = (file) => typeof file === 'string' && !path.posix.isAbsolute(file) &&
    path.posix.normalize(file) === file && !file.startsWith('../') && !file.includes('\\');
  if (!Array.isArray(paths) || !paths.every(exact)) throw refuse('accepted dispatch needs exact relative changed paths');
  return [...new Set(paths)].sort();
}

function dispatchDirectory(tree) {
  return path.join(lib.cacheDir(tree), 'dispatch', hash(fs.realpathSync(tree)));
}
function dispatchFile(tree, id) {
  return path.join(dispatchDirectory(tree), `${hash(id)}.json`);
}
function currentFile(tree, intent, item) {
  return path.join(dispatchDirectory(tree), `current-${hash([intent, item])}.json`);
}

function saveDispatch(tree, record) {
  const body = { ...record };
  delete body.signature;
  const signed = { ...body, signature: signature(body, key(tree, true)) };
  for (const file of [dispatchFile(tree, record.dispatchId), currentFile(tree, record.assignment.intent, record.assignment.item)]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const pending = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(pending, `${JSON.stringify(signed)}\n`, { mode: 0o600 });
    fs.renameSync(pending, file);
  }
  return signed;
}

function validateDispatch(tree, record, expected = {}, accepted = true) {
  const secret = key(tree);
  const { signature: signed, ...body } = record || {};
  if (!secret || signed !== signature(body, secret) || record.version !== 1 ||
      record.tree !== fs.realpathSync(tree) || !record.dispatchId) {
    throw refuse('dispatch snapshot signature or tree identity is invalid');
  }
  for (const field of ['intent', 'item']) {
    if (expected[field] && record.assignment[field] !== expected[field]) throw refuse(`dispatch snapshot belongs to another ${field}`);
  }
  const current = readJson(currentFile(tree, record.assignment.intent, record.assignment.item));
  if (!current || current.dispatchId !== record.dispatchId) throw refuse('dispatch was superseded by a newer item attempt');
  if (accepted && record.phase !== 'accepted') throw refuse('item verification needs an accepted dispatch snapshot');
  return record;
}

/** The orchestrator captures this immediately before it launches the builder. */
function recordDispatch(tree, options) {
  const id = options.dispatch_id;
  if (!id || !options.intent || !options.item || !Array.isArray(options.editable)) {
    throw refuse('dispatch baseline needs intent, item, dispatch_id and editable paths');
  }
  const prior = readJson(dispatchFile(tree, id));
  if (prior) {
    validateDispatch(tree, prior, options, false);
    if (hash(prior.assignment.ownership.editable) !== hash(options.editable)) throw refuse('dispatch ownership is immutable');
    return prior;
  }
  return saveDispatch(tree, {
    version: 1,
    tree: fs.realpathSync(tree),
    dispatchId: id,
    phase: 'started',
    assignment: { intent: options.intent, item: options.item, ownership: { editable: options.editable } },
    beforeSnapshot: captureSnapshot(tree),
  });
}

/**
 * Freeze the accepted result, checked against the baseline: every path the builder reports
 * has to be a change since its dispatch. A retry cannot replace the bytes already accepted.
 */
function acceptDispatch(tree, options) {
  const record = readJson(dispatchFile(tree, options.dispatch_id));
  validateDispatch(tree, record, options, false);
  if (record.phase === 'accepted') return record;
  if (!Array.isArray(options.changed_paths)) throw refuse('accepting a dispatch requires exact changed_paths');
  const candidate = { ...record, completion: { filesModified: options.changed_paths } };
  const snapshot = captureSnapshot(tree);
  const changed = snapshotDelta(record.beforeSnapshot, snapshot);
  const missing = claimedPaths(candidate).filter((file) => !changed.includes(file));
  if (missing.length > 0) throw refuse(`accepted paths have no dispatch patch: ${missing.join(', ')}`);
  return saveDispatch(tree, { ...candidate, phase: 'accepted', acceptedSnapshot: snapshot });
}

function loadDispatch(tree, options) {
  const file = options.dispatch_id ? dispatchFile(tree, options.dispatch_id) : currentFile(tree, options.intent, options.item);
  const record = options.snapshot || readJson(file);
  if (!record) {
    throw refuse(`no dispatch recorded for ${options.dispatch_id || options.item}: run dispatch-log before the builder ` +
      'starts and accept-dispatch on its result, or name a baseline with --since');
  }
  return validateDispatch(tree, record, options);
}

/** The accepted, current dispatches of this tree: the peers that may explain a change. */
function acceptedPeers(tree) {
  const directory = dispatchDirectory(tree);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
    .map((file) => readJson(path.join(directory, file)))
    .filter((record) => {
      if (!record || record.phase !== 'accepted') return false;
      const current = readJson(currentFile(tree, record.assignment.intent, record.assignment.item));
      return Boolean(current) && current.dispatchId === record.dispatchId;
    });
}

/** A peer explains only its own accepted paths, and only on the same baseline commit. */
function explainedByPeers(tree, record, editable, peers, changes) {
  const { changed, current, claimed } = changes;
  const explained = new Set();
  for (const peer of peers) {
    validateDispatch(tree, peer);
    if (peer.dispatchId === record.dispatchId || peer.beforeSnapshot.head_sha !== record.beforeSnapshot.head_sha) continue;
    const peerChanged = snapshotDelta(peer.beforeSnapshot, peer.acceptedSnapshot);
    for (const file of claimedPaths(peer)) {
      if (!peerChanged.includes(file) || !lib.ownedBy(file, peer.assignment.ownership.editable, tree)) {
        throw refuse('peer dispatch claims an unverified or unowned path');
      }
      if (!changed.includes(file) && !current.changed.includes(file)) continue;
      if (same(peer.acceptedSnapshot, record.beforeSnapshot, file)) continue;
      if (!same(peer.beforeSnapshot, record.beforeSnapshot, file)) continue;
      if (claimed.includes(file) || lib.ownedBy(file, editable, tree)) throw refuse(`dispatch ownership overlaps at ${file}`);
      if (same(peer.acceptedSnapshot, current.snapshot, file)) explained.add(file);
    }
  }
  return explained;
}

/** Every path changed since the dispatch that neither this dispatch nor a peer accounts for. */
function verifyDispatch(tree, record, editable, options = {}) {
  validateDispatch(tree, record);
  const changed = snapshotDelta(record.beforeSnapshot, record.acceptedSnapshot);
  const claimed = claimedPaths(record);
  const missing = claimed.filter((file) => !changed.includes(file));
  if (missing.length > 0) throw refuse(`accepted paths have no dispatch patch: ${missing.join(', ')}`);
  const snapshot = captureSnapshot(tree);
  const current = { snapshot, changed: snapshotDelta(record.beforeSnapshot, snapshot) };
  for (const file of claimed) {
    if (!same(snapshot, record.acceptedSnapshot, file)) throw refuse(`accepted dispatch bytes changed at ${file}`);
  }
  const explained = explainedByPeers(tree, record, editable, options.peers || acceptedPeers(tree), { changed, current, claimed });
  const owned = (file) => lib.ownedBy(file, editable, tree) && lib.ownedBy(file, record.assignment.ownership.editable, tree);
  const outside = [...new Set([...changed, ...current.changed])]
    .sort()
    .filter((file) => (claimed.includes(file) ? !owned(file) : !explained.has(file)));
  return {
    since: record.beforeSnapshot.head_sha,
    head_sha: record.acceptedSnapshot.head_sha,
    dispatch_id: record.dispatchId,
    changed: claimed,
    all_changed: changed,
    outside,
  };
}

module.exports = {
  acceptDispatch,
  captureSnapshot,
  hash,
  loadDispatch,
  recordDispatch,
  snapshotDelta,
  validateDispatch,
  verifyDispatch,
};
