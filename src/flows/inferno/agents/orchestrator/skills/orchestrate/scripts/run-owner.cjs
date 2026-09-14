'use strict';

/**
 * Who owns an intent worktree right now, as a fact `select` can read without touching the tree.
 *
 * The recovery heuristic used to be two signals: no process with its cwd in the worktree, and
 * no commit or edit there for `recovery.idle_minutes`. Both are false for a live session whose
 * run is a detached gate: the gate is parented by systemd and works from the cache dir, and its
 * last step is a 39-minute integration suite that commits nothing. On 2026-09-10 a second
 * session recovered such an intent, and the two sessions' gates went red on each other's
 * binary until both had killed the other's job. Idle time in a worktree is not evidence that
 * nobody owns it.
 *
 * So every tree-bound step of run.cjs stamps the session it serves into `owner.json` beside the
 * branch's gate job, and `select` treats a live owner session, or a live gate job, as ownership.
 * Recovery is offered only when both are gone.
 *
 * Zero dependencies, like everything in this directory. Linux /proc only: elsewhere the session
 * cannot be found, nothing is recorded, and the older signals decide as before.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

/** The kernel's start tick for a pid, or null when it is gone. Field 22 of /proc/pid/stat. */
function processStart(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(fields[19]) || null;
  } catch (error) {
    return null;
  }
}

/**
 * The agent session this runner serves: the nearest ancestor whose program is `claude` or
 * `codex`, with its start tick so a recycled pid is never mistaken for it. Null where no such
 * ancestor exists (a detached gate, a hand-run shell), and null means no record is written
 * rather than a wrong one.
 */
function sessionProcess(pid = process.pid) {
  let current = pid;
  for (let depth = 0; depth < 32 && current > 1; depth += 1) {
    let cmdline;
    let status;
    try {
      cmdline = fs.readFileSync(`/proc/${current}/cmdline`, 'utf8');
      status = fs.readFileSync(`/proc/${current}/status`, 'utf8');
    } catch (error) {
      return null;
    }
    const program = path.basename(cmdline.split('\0')[0] || '');
    if (program === 'claude' || program === 'codex') return { pid: current, start: processStart(current) };
    const parent = /^PPid:\s*(\d+)/m.exec(status);
    if (!parent) return null;
    current = Number(parent[1]);
  }
  return null;
}

function ownerFile(tree) {
  return path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'owner.json');
}

/** Stamp the session running this step as the tree's owner. Never throws: a step must not fail on bookkeeping. */
function recordOwner(tree, step, session = sessionProcess()) {
  if (!session) return null;
  const record = { pid: session.pid, start: session.start, step, at: new Date().toISOString() };
  try {
    const file = ownerFile(tree);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    return null;
  }
  return record;
}

function readOwner(tree) {
  try {
    return JSON.parse(fs.readFileSync(ownerFile(tree), 'utf8'));
  } catch (error) {
    return null;
  }
}

/** Is the recorded owner still the same live process. */
function ownerAlive(owner) {
  if (!owner || !owner.pid) return false;
  const start = processStart(owner.pid);
  if (start === null) return false;
  return owner.start === null || owner.start === undefined || start === owner.start;
}

/** The detached gate job still running for this tree's branch, whoever started it, or null. */
function gateJobAlive(tree) {
  let job;
  try {
    job = JSON.parse(fs.readFileSync(path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'gate-job.json'), 'utf8'));
  } catch (error) {
    return null;
  }
  if (!job || !job.pid) return null;
  try {
    if (!fs.readFileSync(`/proc/${job.pid}/cmdline`, 'utf8').includes('run.cjs')) return null;
  } catch (error) {
    return null;
  }
  return job;
}

/** What `select` says about a tree: a live owner, a live gate, or nothing. */
function ownership(tree, now = Date.now()) {
  const owner = readOwner(tree);
  if (ownerAlive(owner)) {
    const minutes = Math.max(0, Math.floor((now - Date.parse(owner.at)) / 60000));
    return { kind: 'session', pid: owner.pid, step: owner.step, minutes };
  }
  const job = gateJobAlive(tree);
  if (job) return { kind: 'gate', pid: job.pid, started: job.started };
  return null;
}

module.exports = { gateJobAlive, ownerAlive, ownerFile, ownership, processStart, readOwner, recordOwner, sessionProcess };
