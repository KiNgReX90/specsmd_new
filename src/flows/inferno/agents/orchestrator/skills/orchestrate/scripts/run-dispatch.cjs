'use strict';

/**
 * Dispatch records. `dispatch-log` records a snapshot of the tree immediately before a builder
 * starts, and `accept-dispatch` freezes the result the orchestrator accepted. verify-item
 * attributes every changed path against them (run-attribute.cjs, run-peers.cjs). Without them a
 * parallel round showed every sibling's uncommitted edit as outside the item under review, and
 * nothing tied a builder's reported files to what it actually changed.
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
const { execFileSync } = require('child_process');

const lib = require('./run-lib.cjs');
const { atomicWrite, withStateLock } = require('./state-store.cjs');

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

/** `info/exclude` as git names it: shared by every worktree of the repository. */
const excludeFile = (tree) => lib.git(tree, ['rev-parse', '--git-path', 'info/exclude']);

/**
 * The untracked paths `info/exclude` hides, by identity, a folder it hides whole as `folder/`.
 * git also lists a folder whose only contents are hidden files, beside those files: that folder
 * entry is dropped.
 */
function hiddenPaths(tree) {
  const exclude = path.resolve(tree, excludeFile(tree));
  const hidden = {};
  if (!fs.existsSync(exclude)) return hidden;
  const listed = gitNames(tree, ['ls-files', '--others', '--ignored', '--directory', `--exclude-from=${exclude}`]);
  for (const file of listed) {
    if (!file.endsWith('/')) hidden[file] = entryOf(path.join(tree, file));
    else if (!listed.some((other) => other !== file && other.startsWith(file))) hidden[file] = { kind: 'folder' };
  }
  return hidden;
}

/**
 * Every tracked and untracked path by identity, so uncommitted builder output is captured too,
 * and apart from them the paths `info/exclude` hides, so a line added there hides nothing.
 */
function captureSnapshot(tree) {
  const files = {};
  for (const file of [...new Set(gitNames(tree, ['ls-files', '--cached', '--others', '--exclude-standard']))].sort()) {
    files[file] = entryOf(path.join(tree, file));
  }
  return { version: 1, head_sha: lib.git(tree, ['rev-parse', 'HEAD']), files, digest: hash(files), hidden: hiddenPaths(tree) };
}

/**
 * A snapshot a record stores, numbered from the tree's sequence under the ledger's lock, so
 * the snapshots of every dispatch of one tree line up in the order they were taken.
 */
function sequencedSnapshot(tree) {
  const file = path.join(dispatchDirectory(tree), 'sequence');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withStateLock(file, () => {
    const seq = (Number.parseInt(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '0', 10) || 0) + 1;
    atomicWrite(file, `${seq}\n`);
    return { ...captureSnapshot(tree), seq };
  });
}

/** A path's identity in a snapshot, read from the hidden paths when `info/exclude` hid it. */
const entryIn = (snapshot, file) => snapshot.files[file] || (snapshot.hidden || {})[file] || null;
const identity = (snapshot, file) => {
  const entry = entryIn(snapshot, file);
  return entry ? `${entry.kind} ${entry.hash} ${entry.executable ? 'x' : '-'}` : 'none';
};
const same = (left, right, file) => identity(left, file) === identity(right, file);

function checkSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !snapshot.files || snapshot.digest !== hash(snapshot.files) ||
      !/^[a-f0-9]{40,64}$/.test(snapshot.head_sha || '')) {
    throw refuse('dispatch baseline or accepted snapshot is missing or changed');
  }
  return snapshot;
}

/** Paths whose identity differs between two snapshots, the snapshots checked first unless `checked`. */
function snapshotDelta(before, after, checked = false) {
  if (!checked) [before, after].forEach(checkSnapshot);
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
  acceptDispatch,
  captureSnapshot,
  checkSnapshot,
  claimedPaths,
  coveredItems,
  currentRecords,
  effective,
  entryIn,
  excludeFile,
  hash,
  identity,
  itemsOf,
  lineage,
  loadDispatch,
  recordDispatch,
  recordFile,
  refuse,
  same,
  snapshotDelta,
  validateDispatch,
};
