'use strict';

/**
 * The processes a run owns in its intent worktree, and the only ones teardown may signal.
 *
 * Teardown used to send SIGTERM to every process whose cwd sat inside the worktree. A cwd is
 * not ownership: a user's shell, an editor or another session's job in that directory got the
 * same signal, and so did a pid the kernel had handed to something else. So the run keeps a
 * record in the worktree's own git dir (it goes when the worktree goes), registers each
 * process it launches there by its full identity (pid, start time, boot id, command line,
 * cwd), and teardown signals an entry only while the live process still has that identity.
 * A tree with no record has nothing registered and gets no signal.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { intentOf, worktreeEntries } = require('./run-worktrees.cjs');

const { RunError } = lib;
const RECORD = 'inferno-processes.json';

function real(dir) {
  return fs.realpathSync(dir);
}

/**
 * The linked worktree `tree` is, or a refusal: never the primary checkout, never a tree of
 * another repository, never a path git does not list as a worktree on a branch, and, when
 * `intent` is named, never the worktree of another intent.
 */
function linkedTree(primary, tree, intent) {
  primary = real(primary);
  tree = real(tree);
  if (tree === primary) throw new RunError(`refusing ${tree}: it is the primary checkout, not an intent worktree`, 'PRIMARY');
  if (real(lib.primaryRoot(tree)) !== primary) throw new RunError(`refusing ${tree}: it belongs to another repository`, 'NOT_A_WORKTREE');
  const entry = worktreeEntries(primary).find((candidate) => fs.existsSync(candidate.path) && real(candidate.path) === tree);
  if (!entry || !entry.branch) throw new RunError(`${tree} is not a linked worktree of ${primary} on a branch`, 'NOT_A_WORKTREE');
  if (intent && intentOf(entry.branch) !== intent) {
    throw new RunError(`refusing ${tree}: its branch ${entry.branch} is not the worktree of ${intent}`, 'NOT_A_WORKTREE');
  }
  return { primary, tree, branch: entry.branch };
}

function recordPath(tree) {
  return path.resolve(tree, lib.git(tree, ['rev-parse', '--git-path', RECORD]));
}

function loadOwnership(tree) {
  try {
    const record = JSON.parse(fs.readFileSync(recordPath(tree), 'utf8'));
    return record && record.version === 1 && Array.isArray(record.processes) ? record : null;
  } catch (error) {
    return null;
  }
}

function save(record) {
  const file = recordPath(record.tree);
  const pending = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(pending, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  fs.renameSync(pending, file);
  return record;
}

/**
 * Called by `worktree` on create and on resume, before any run-owned process starts. A record
 * of another run is replaced, which forgets its processes: forgetting only means fewer signals.
 */
function recordOwnership(tree, context) {
  const identity = linkedTree(lib.primaryRoot(tree), tree, context.intent);
  const previous = loadOwnership(identity.tree);
  if (previous && previous.run_id === context.run_id && previous.branch === identity.branch && previous.tree === identity.tree) {
    return previous;
  }
  return save({ version: 1, intent: context.intent, ...identity, run_id: context.run_id, processes: [] });
}

/** The live identity of `pid` where /proc can answer, otherwise null, which registers nothing. */
function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const starttime = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    const command = fs.readFileSync(`/proc/${pid}/cmdline`).toString('base64');
    const boot_id = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    return starttime && command && boot_id ? { pid, starttime, command, boot_id, cwd } : null;
  } catch (error) {
    return null;
  }
}

function inside(tree, cwd) {
  return typeof cwd === 'string' && (cwd === tree || cwd.startsWith(`${tree}${path.sep}`));
}

function matching(left, right) {
  return ['pid', 'starttime', 'boot_id', 'command', 'cwd'].every((key) => left?.[key] !== undefined && left[key] === right?.[key]);
}

/** Whether this system can tell a process's identity at all. */
function canIdentify(transport = {}) {
  return transport.proc !== undefined ? transport.proc : fs.existsSync('/proc/self/stat');
}

/**
 * Register a process the run just launched in its worktree, by its pid, never by a cwd scan.
 * Null on a system without /proc: nothing is registered there, so teardown stops nothing.
 */
function registerProcess(tree, pid, runId, transport = {}) {
  const record = loadOwnership(tree);
  if (!record || record.run_id !== runId) {
    throw new RunError(`registering a process needs the run that owns ${tree}; open it with run.cjs worktree first`, 'PROCESS_OWNER');
  }
  if (!canIdentify(transport)) return null;
  const identity = (transport.inspect || processIdentity)(pid);
  if (!identity || !inside(record.tree, identity.cwd) || pid === process.pid || pid === process.ppid) {
    throw new RunError(`process ${pid} cannot be verified as running inside ${record.tree}`, 'PROCESS_OWNER');
  }
  if (!record.processes.some((entry) => matching(entry, identity))) record.processes.push({ ...identity, run_id: runId });
  return save(record);
}

/** SIGTERM each registered process of the record's run that still has its registered identity. */
function stopOwnedProcesses(record, transport = {}) {
  if (!record || !record.run_id || !record.tree || !Array.isArray(record.processes)) return [];
  const inspect = transport.inspect || processIdentity;
  const kill = transport.kill || ((pid, signal) => process.kill(pid, signal));
  const stopped = [];
  for (const entry of record.processes) {
    if (entry.run_id !== record.run_id || !Number.isSafeInteger(entry.pid) || entry.pid <= 1) continue;
    if (entry.pid === process.pid || entry.pid === process.ppid || !inside(record.tree, entry.cwd)) continue;
    if (!matching(entry, inspect(entry.pid))) continue;
    try {
      kill(entry.pid, 'SIGTERM');
      stopped.push(entry.pid);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  return stopped;
}

module.exports = { canIdentify, linkedTree, loadOwnership, matching, processIdentity, recordOwnership, registerProcess, stopOwnedProcesses };
