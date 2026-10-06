'use strict';

/**
 * Snapshots of a tree for dispatch attribution: every tracked and untracked path by identity,
 * and the paths `info/exclude` hides. A snapshot a dispatch record stores takes the next number
 * of the tree's sequence while it holds the tree's sequence lock, so numbers follow the order the
 * snapshots were taken. A per-tree stat index lets a warm snapshot read only the files that
 * changed, which keeps a round of snapshots well inside the lock's wait.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const lib = require('./run-lib.cjs');
const { atomicWrite } = require('./state-store.cjs');

const { RunError } = lib;

/** How long a snapshot waits for the tree's sequence: a full batched round of snapshots. */
const SEQUENCE_WAIT_MS = 5 * 60 * 1000;

/**
 * A file whose times were this young when it was read is never kept in the stat index. FAT keeps
 * file times in two-second steps, so a file is kept only once its times are older than the
 * coarsest common filesystem clock.
 */
const RACY_MS = 2000;

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

function dispatchDirectory(tree) {
  return path.join(lib.cacheDir(tree), 'dispatch', hash(fs.realpathSync(tree)));
}

/** The tree's stat index: a file's content hash, kept while its size, times, inode and mode hold. */
function statIndex(tree) {
  const file = path.join(dispatchDirectory(tree), 'index.json');
  const known = readJson(file) || {};
  const kept = {};
  return {
    contentOf(relative, target, stat) {
      const stamp = [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino, stat.mode].join(':');
      const entry = known[relative] && known[relative].stamp === stamp ? known[relative]
        : { stamp, hash: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') };
      if (Date.now() - Math.max(stat.mtimeMs, stat.ctimeMs) > RACY_MS) kept[relative] = entry;
      return entry.hash;
    },
    save() {
      atomicWrite(file, JSON.stringify(kept));
    },
  };
}

/** One path's identity: a file by content, a link by target, a submodule by its commit. */
function entryOf(tree, relative, index) {
  const target = path.join(tree, relative);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return { kind: 'symlink', hash: hash(fs.readlinkSync(target)), executable: false };
  if (stat.isFile()) return { kind: 'file', hash: index.contentOf(relative, target, stat), executable: Boolean(stat.mode & 0o111) };
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
function hiddenPaths(tree, index) {
  const exclude = path.resolve(tree, excludeFile(tree));
  const hidden = {};
  if (!fs.existsSync(exclude)) return hidden;
  const listed = gitNames(tree, ['ls-files', '--others', '--ignored', '--directory', `--exclude-from=${exclude}`]);
  for (const file of listed) {
    if (!file.endsWith('/')) hidden[file] = entryOf(tree, file, index);
    else if (!listed.some((other) => other !== file && other.startsWith(file))) hidden[file] = { kind: 'folder' };
  }
  return hidden;
}

/**
 * Every tracked and untracked path by identity, so uncommitted builder output is captured too,
 * and apart from them the paths `info/exclude` hides, so a line added there hides nothing.
 */
function captureSnapshot(tree) {
  const index = statIndex(tree);
  const files = {};
  for (const file of [...new Set(gitNames(tree, ['ls-files', '--cached', '--others', '--exclude-standard']))].sort()) {
    files[file] = entryOf(tree, file, index);
  }
  const hidden = hiddenPaths(tree, index);
  index.save();
  return { version: 1, head_sha: lib.git(tree, ['rev-parse', 'HEAD']), files, digest: hash(files), hidden };
}

function processStart(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19];
  } catch (error) {
    return null;
  }
}

function holderGone(holder) {
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return true;
  }
  const start = processStart(holder.pid);
  return Boolean(start && holder.start && start !== holder.start);
}

/** Remove a lock whose holder is gone, under a guard so a fresh lock is never taken for it. */
function clearStale(lock, token) {
  const guard = `${lock}.guard`;
  try {
    fs.writeFileSync(guard, String(process.pid), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (Date.now() - fs.statSync(guard).mtimeMs > 10000) fs.rmSync(guard, { force: true });
    return;
  }
  try {
    if ((readJson(lock) || {}).token === token) fs.rmSync(lock, { force: true });
  } finally {
    fs.rmSync(guard, { force: true });
  }
}

/**
 * Run `fn` holding the tree's sequence lock, a file of its own in the dispatch directory that
 * never blocks a ledger transition. It waits up to `options.wait` for another snapshot of the
 * tree and takes over from a holder that is gone. Past the wait it refuses and names the holder.
 */
function withSequenceLock(tree, fn, options = {}) {
  const directory = dispatchDirectory(tree);
  const lock = path.join(directory, 'sequence.lock');
  const wait = options.wait === undefined ? SEQUENCE_WAIT_MS : options.wait;
  const pause = options.sleep || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const holder = { pid: process.pid, start: processStart(process.pid), since: new Date().toISOString(), token: crypto.randomUUID() };
  const candidate = `${lock}.${holder.token}`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(candidate, JSON.stringify(holder), { mode: 0o600 });
  const deadline = Date.now() + wait;
  try {
    for (;;) {
      try {
        fs.linkSync(candidate, lock);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const current = readJson(lock);
      if (current && holderGone(current)) {
        clearStale(lock, current.token);
        continue;
      }
      if (Date.now() >= deadline) {
        throw refuse(`the dispatch sequence lock ${lock} is held by pid ${current ? current.pid : 'unknown'} since ` +
          `${current ? current.since : 'an unknown time'}: another dispatch-log or accept-dispatch of this tree is still taking its ` +
          'snapshot, so run this step again once that process ends');
      }
      pause(50);
    }
  } finally {
    fs.rmSync(candidate, { force: true });
  }
  try {
    return fn();
  } finally {
    if ((readJson(lock) || {}).token === holder.token) fs.rmSync(lock, { force: true });
  }
}

/** A snapshot a record stores: the tree's next sequence number, taken with the snapshot under the lock. */
function sequencedSnapshot(tree, options = {}) {
  return withSequenceLock(tree, () => {
    const file = path.join(dispatchDirectory(tree), 'sequence');
    const seq = (Number.parseInt(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '0', 10) || 0) + 1;
    atomicWrite(file, `${seq}\n`);
    return { ...captureSnapshot(tree), seq };
  }, options);
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

module.exports = {
  captureSnapshot,
  checkSnapshot,
  dispatchDirectory,
  entryIn,
  excludeFile,
  hash,
  identity,
  readJson,
  refuse,
  same,
  sequencedSnapshot,
  snapshotDelta,
  stable,
};
