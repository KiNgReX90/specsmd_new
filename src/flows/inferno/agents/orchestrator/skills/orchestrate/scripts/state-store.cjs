'use strict';

/**
 * The ledger's storage boundary: one lock per repository ledger, a generation check before
 * every write, and an atomic replace.
 *
 * Why: one shared writer module is not one writer process. Two sessions could both read
 * `pending`, both claim, and leave only the second claim on disk; two completions of
 * different items could each overwrite the other's update; and a crash inside a truncating
 * write left a half-written ledger. Every transition therefore runs its read, check and write
 * inside `withStateLock`, refuses to write over bytes that changed since its own read, and
 * replaces the file by rename so a reader sees the old file or the new one, never a mix.
 *
 * The lock lives in the git common directory, so every worktree of a repository contends on
 * the same lock and nothing appears in the tree. Outside git it sits beside the ledger. It is
 * held for one transition only, never across a build or an agent call.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { TransitionError } = require('./state-ledger.cjs');

const active = new Map();
const DEFAULT_LOCK_TIMEOUT_MS = 10000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const digest = (file) => (fs.existsSync(file)
  ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);

function canonicalFile(file) {
  const absolute = path.resolve(file);
  return fs.existsSync(absolute)
    ? fs.realpathSync(absolute)
    : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
}

function lockPath(file) {
  const dir = path.dirname(canonicalFile(file));
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8' });
  return result.status === 0
    ? path.join(fs.realpathSync(path.resolve(dir, result.stdout.trim())), 'inferno-state.lock')
    : path.join(dir, '.inferno-state.lock');
}

/** Process start time where the platform exposes it, so a reused pid is not taken for the owner. */
function processIdentity(pid) {
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]; } catch { return null; }
}

function ownerAlive(owner) {
  try { process.kill(owner.pid, 0); } catch (error) { return error.code !== 'ESRCH'; }
  const current = processIdentity(owner.pid);
  return !current || !owner.start || current === owner.start;
}

// A directory cannot be opened for fsync on every platform; the rename has already landed.
function syncDirectory(dir) {
  let handle;
  try { handle = fs.openSync(dir, 'r'); fs.fsyncSync(handle); } catch { /* best effort */ } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

/** Write a temp file, flush it, rename it over the target and flush the directory. */
function atomicWrite(file, content, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    const mode = fs.existsSync(file) ? fs.statSync(file).mode : 0o644;
    fd = fs.openSync(temp, 'wx', mode);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (options.failpoint) options.failpoint('before-rename');
    fs.renameSync(temp, file);
    syncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}

/**
 * Take the lock by hard-linking a private candidate file onto the lock path. A dead owner's
 * lock is removed only under a short guard, so two processes reclaiming the same stale lock
 * cannot remove the lock the first of them just took.
 */
function acquire(lock, owner, candidate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let guard;
    try { guard = fs.openSync(`${lock}.guard`, 'wx', 0o600); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) {
        throw new TransitionError(`the ledger lock recovery guard is held: inspect ${lock}.guard before removing it`, 'STATE_LOCKED');
      }
      sleep(10);
      continue;
    }
    let acquired = false;
    try {
      fs.writeFileSync(guard, JSON.stringify(owner));
      try {
        if (!ownerAlive(JSON.parse(fs.readFileSync(lock, 'utf8')))) fs.unlinkSync(lock);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { fs.linkSync(candidate, lock); acquired = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally {
      fs.closeSync(guard);
      fs.unlinkSync(`${lock}.guard`);
    }
    if (acquired) return;
    if (Date.now() > deadline) throw new TransitionError(`the ledger is held by another writer: ${lock}`, 'STATE_LOCKED');
    sleep(10);
  }
}

/** Run `fn` holding the ledger lock. Re-entrant within one process for the same ledger. */
function withStateLock(file, fn, options = {}) {
  const key = canonicalFile(file);
  if (active.has(key)) return fn();
  const lock = lockPath(key);
  const owner = { pid: process.pid, start: processIdentity(process.pid), token: crypto.randomUUID() };
  const candidate = `${lock}.${owner.token}`;
  fs.writeFileSync(candidate, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  try {
    acquire(lock, owner, candidate, options.lockTimeoutMs || DEFAULT_LOCK_TIMEOUT_MS);
    active.set(key, { generation: digest(key), options, read: false });
    return fn();
  } finally {
    active.delete(key);
    try {
      if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === owner.token) fs.unlinkSync(lock);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.rmSync(candidate, { force: true });
  }
}

/** Called by the ledger reader; lets a test act between a transition's read and its write. */
function afterRead(file) {
  const tx = active.get(canonicalFile(file));
  if (tx && !tx.read) {
    tx.read = true;
    if (tx.options.afterRead) tx.options.afterRead();
  }
}

/** Replace the ledger, refusing when its bytes changed since this transaction began. */
function writeState(file, lines) {
  const key = canonicalFile(file);
  const tx = active.get(key);
  if (!tx) return withStateLock(file, () => writeState(file, lines));
  if (digest(key) !== tx.generation) {
    throw new TransitionError('the ledger changed outside this transaction; read it again and retry', 'STATE_GENERATION');
  }
  atomicWrite(key, lines.join('\n'), tx.options);
  tx.generation = digest(key);
  return undefined;
}

module.exports = { afterRead, atomicWrite, canonicalFile, lockPath, withStateLock, writeState };
