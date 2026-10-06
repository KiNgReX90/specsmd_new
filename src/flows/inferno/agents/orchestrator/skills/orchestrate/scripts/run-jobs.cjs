'use strict';

/**
 * The detached jobs of a tree: the gate, and one per configured lane. Each job is a run.cjs
 * process of its own with a job file, a result file and a log beside the branch's cache, so
 * `gate --wait`, `select` and teardown can find it without the session that started it.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const lib = require('./run-lib.cjs');
const processes = require('./run-processes.cjs');
const { LANES } = require('./run-lane-config.cjs');

/** The gate's files, or a lane's when `lane` names one. */
function jobPaths(tree, lane) {
  const dir = path.join(lib.cacheDir(tree), lib.currentBranch(tree));
  const stem = lane ? `lane-${lane}-job` : 'gate-job';
  return {
    job: path.join(dir, `${stem}.json`),
    result: path.join(dir, `${stem}.result.json`),
    log: path.join(dir, `${stem}.log`),
  };
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return null;
  }
}

/** Is the job's process still the run.cjs we started, and still running. */
function alive(job) {
  if (!job || !job.pid) return false;
  try {
    if (!fs.readFileSync(`/proc/${job.pid}/cmdline`, 'utf8').includes('run.cjs')) return false;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
  }
  try {
    process.kill(job.pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** The gate job and every lane job recorded for the tree's branch, whether running or not. */
function everyJob(tree) {
  return [null, ...LANES]
    .map((lane) => readJson(jobPaths(tree, lane).job))
    .filter((job) => job && job.pid);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Start `node run.cjs <args>` as its own process with stdout in the result file and stderr in
 * the log, register it so teardown may stop it, and write its job file.
 */
function detach(tree, args, paths, fields) {
  fs.mkdirSync(path.dirname(paths.job), { recursive: true });
  const out = fs.openSync(paths.result, 'w');
  const err = fs.openSync(paths.log, 'w');
  const child = spawn(process.execPath, [path.join(__dirname, 'run.cjs'), ...args], {
    cwd: tree, detached: true, stdio: ['ignore', out, err],
  });
  fs.closeSync(out);
  fs.closeSync(err);
  child.unref();
  const owner = processes.loadOwnership(tree);
  const identity = processes.processIdentity(child.pid);
  if (owner && identity) processes.registerProcess(tree, child.pid, owner.run_id, { inspect: () => identity });
  const job = { pid: child.pid, ...fields, started: new Date().toISOString(), tree, branch: lib.currentBranch(tree), ...paths };
  fs.writeFileSync(paths.job, `${JSON.stringify(job)}\n`, 'utf8');
  return job;
}

module.exports = { alive, detach, everyJob, jobPaths, readJson, sleepSync };
