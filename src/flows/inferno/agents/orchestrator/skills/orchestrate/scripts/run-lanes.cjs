'use strict';

/**
 * The smoke and Windows lanes in the gate. `gate --detach` starts each configured lane whose
 * scope the branch touched as a job of its own, `gate --wait` waits for the gate and every lane,
 * and `green` owes the smoke lane while it is in scope and unproven.
 *
 * Exit contract of a host lane command: 0 green, 10 product red, 11 instrument red, and any
 * other code is instrument red too. The host runner does its own single retry; the flow never
 * retries a lane. An instrument red is accepted only against a harness fix already on the base
 * branch, recorded by `run.cjs smoke --accept --harness-fix <sha>` for the tree it ran on.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const jobs = require('./run-jobs.cjs');
const { configuredLanes } = require('./run-lane-config.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { gateStartCall, gateWaitCall, laneAcceptCall } = require('./run-call.cjs');

const { RunError } = lib;
const DEFAULT_CONFIG = `${lib.SPECS_DIR}/config.yaml`;
const PRODUCT_RED = 10;
const ACCEPTED = '.instrument-red';
/** gate --wait's exit when every job ended and a lane is instrument red with no accepted harness fix. */
const UNBOUNDED_EXIT = 3;
/** run.cjs prints at most this many human lines. */
const MAX_LINES = 30;

/** A lane's proof is keyed like a finalize command's, by its command, its config and its own scope. */
function laneProof(tree, selected, lane) {
  return proofs.commandProof(tree, {}, selected, lane.command, lane.scope);
}

function writeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(pending, `${JSON.stringify(record)}\n`);
  fs.renameSync(pending, file);
}

/**
 * The accepted instrument red for exactly this proof's inputs, or null. A record binds the one
 * run it accepted: it holds only while the lane's latest result is that same instrument-red
 * run, so any later run of the lane, red or green, retires it.
 */
function readAccepted(tree, name, proof) {
  const record = jobs.readJson(`${proof.file}${ACCEPTED}`);
  const latest = jobs.readJson(jobs.jobPaths(tree, name).result);
  const matches = record && record.command === proof.command && record.config === proof.config && record.hash === proof.hash &&
    typeof record.harness_fix === 'string' && typeof record.run === 'string';
  return matches && latest && latest.run === record.run ? record : null;
}


function touched(lane, changed) {
  return changed.some((file) => lib.matchesAny(file, lane.scope));
}

function laneOf(config, name, selected) {
  const lane = configuredLanes(config).find((entry) => entry.name === name);
  if (!lane) {
    throw new RunError(`no verification.${name} in ${selected || DEFAULT_CONFIG}: configure the lane there first.`, 'NO_LANE');
  }
  return lane;
}

/** Start every configured lane the branch touched and holds no proof for; returns the started names. */
function startLanes(tree, options, config, changed) {
  const started = [];
  const out = [];
  for (const lane of configuredLanes(config)) {
    if (!touched(lane, changed)) {
      out.push(`SKIP ${lane.name} (no path in scope changed)`);
      continue;
    }
    const proof = laneProof(tree, options.config, lane);
    const green = !options.force && proofs.readProof(proof);
    const accepted = !options.force && readAccepted(tree, lane.name, proof);
    if (green) out.push(`GREEN lane ${lane.name} (unchanged since ${green.stamp})`);
    else if (accepted) out.push(`ACCEPTED lane ${lane.name} instrument red, harness fix ${accepted.harness_fix.slice(0, 7)}`);
    if (green || accepted) continue;
    const args = ['gate', '--lane', lane.name, '--tree', tree, '--json'];
    if (options.config) args.push('--config', options.config);
    const job = jobs.detach(tree, args, jobs.jobPaths(tree, lane.name), { lane: lane.name });
    started.push(lane.name);
    out.push(`${lane.name} lane started pid ${job.pid}`, `log ${job.log}`);
  }
  return { started, out };
}

/** `gate --lane <name>`: run one lane's command in this process and classify its exit. */
function laneNow(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const lane = laneOf(lib.readConfig(tree, options.config), options.lane, options.config);
  const proof = laneProof(tree, options.config, lane);
  fs.rmSync(proof.file, { force: true });
  const runId = `${lib.stamp()}-${process.pid}`;
  const log = path.join(lib.cacheDir(tree), lib.currentBranch(tree), `lane-${lane.name}-${lib.stamp()}.log`);
  const run = lib.runShell(lane.command, tree, log);
  const moved = laneProof(tree, options.config, laneOf(lib.readConfig(tree, options.config), lane.name)).file !== proof.file;
  let result = 'instrument-red';
  if (moved) result = 'moved';
  else if (run.code === 0) result = 'green';
  else if (run.code === PRODUCT_RED) result = 'product-red';
  if (result === 'green') {
    const { file, ...identity } = proof;
    writeRecord(file, { ...identity, stamp: new Date().toISOString(), seconds: run.seconds, branch: lib.currentBranch(tree) });
  }
  const payload = { lane: lane.name, run: runId, result, code: run.code, seconds: run.seconds, log, hash: proof.hash };
  return { exit: result === 'green' ? 0 : 2, payload, out: [`${result} lane ${lane.name} exit ${run.code} -> ${log}`] };
}

/** One lane job as it stands: running, its result, or a process that died without one. */
function laneState(tree, name) {
  const paths = jobs.jobPaths(tree, name);
  const job = jobs.readJson(paths.job);
  if (jobs.alive(job)) return { lane: name, state: 'running', pid: job.pid, log: paths.log };
  const result = jobs.readJson(paths.result);
  if (result && result.lane === name) return { ...result, state: result.result };
  return { lane: name, state: 'died', pid: job && job.pid, log: paths.log };
}

function acceptFix(tree, lane, selected) {
  const base = resolveBase(lib.readConfig(tree, selected), null, tree);
  return `land the harness fix on ${base}, then: ${laneAcceptCall(lane, tree)}`;
}

/** The lines for a lane, and whether it holds (green or bounded), fails (2) or is unbounded. */
function describeLane(tree, selected, config, entry) {
  if (entry.state === 'running') return { verdict: 'running', out: [`${entry.lane} lane still running pid ${entry.pid}, log ${entry.log}`] };
  if (entry.state === 'green') return { verdict: 'hold', out: [`GREEN lane ${entry.lane} ${entry.seconds}s`] };
  if (entry.state === 'product-red') {
    return { verdict: 'red', out: [`RED lane ${entry.lane}: product red (exit ${entry.code}) -> ${entry.log}`, ...lib.tail(entry.log, 5)] };
  }
  if (entry.state === 'moved') return { verdict: 'red', out: [`RED lane ${entry.lane}: the code changed while the lane ran. Re-run the gate.`] };
  if (entry.state === 'died') return { verdict: 'red', out: [`lane ${entry.lane} process ${entry.pid} ended without a result -> ${entry.log}`, ...lib.tail(entry.log, 5)] };
  const accepted = readAccepted(tree, entry.lane, laneProof(tree, selected, laneOf(config, entry.lane, selected)));
  if (accepted) return { verdict: 'hold', out: [`ACCEPTED lane ${entry.lane} instrument red, harness fix ${accepted.harness_fix.slice(0, 7)}`] };
  return {
    verdict: 'unbounded',
    out: [`INSTRUMENT RED lane ${entry.lane} (exit ${entry.code}) -> ${entry.log}`, ...lib.tail(entry.log, 5), acceptFix(tree, entry.lane, selected)],
  };
}

/**
 * gate --wait over the gate and every lane it started: 2 as soon as the gate or a lane is red,
 * 4 while anything runs at the deadline, else 0 when every lane holds.
 */
function waitAll(job, options, deadline, gateResult) {
  const tree = job.tree;
  const config = lib.readConfig(tree, options.config);
  for (;;) {
    const gate = jobs.alive(job) ? null : gateResult();
    const lanes = (job.lanes || []).map((name) => ({ name, ...describeLane(tree, options.config, config, laneState(tree, name)) }));
    // An unbounded lane prints last, so its accept line is the last line of the wait.
    const laneOut = [...lanes.filter((entry) => entry.verdict !== 'unbounded'), ...lanes.filter((entry) => entry.verdict === 'unbounded')]
      .flatMap((entry) => entry.out);
    // The gate block gives way to the lane lines, so the 30-line cap never cuts an accept line.
    const fit = (gateOut, tail = []) =>
      [...lib.capLines(gateOut, Math.max(1, MAX_LINES - laneOut.length - tail.length)), ...laneOut, ...tail];
    const lanePayload = { lanes: (job.lanes || []).map((name) => laneState(tree, name)) };
    if ((gate && gate.exit !== 0) || lanes.some((entry) => entry.verdict === 'red')) {
      const gateOut = gate ? gate.out : [`gate still running pid ${job.pid}`];
      return { exit: 2, payload: { ...(gate ? gate.payload : { ok: false }), ok: false, ...lanePayload }, out: fit(gateOut) };
    }
    const running = !gate || lanes.some((entry) => entry.verdict === 'running');
    if (!running) {
      const owed = lanes.filter((entry) => entry.verdict === 'unbounded').map((entry) => entry.name);
      if (owed.length > 0) return { exit: UNBOUNDED_EXIT, payload: { ...gate.payload, ok: false, owed, ...lanePayload }, out: fit(gate.out) };
      return { exit: 0, payload: { ...gate.payload, ...lanePayload }, out: fit(gate.out) };
    }
    if (Date.now() >= deadline) {
      const elapsed = Math.round((Date.now() - Date.parse(job.started)) / 60000);
      const gateOut = gate ? [] : [`gate still running pid ${job.pid}, ${elapsed} min so far`, `log ${job.log}`];
      return {
        exit: 4,
        payload: { running: true, ...job, elapsed_minutes: elapsed, ...lanePayload },
        out: fit(gateOut, [`call ${gateWaitCall(tree, options)} again`]),
      };
    }
    jobs.sleepSync(500);
  }
}

/** `run.cjs <lane> --accept --harness-fix <sha>`: bound that lane's instrument red on this tree, and no other lane's. */
function accept(name, options) {
  if (!options.accept || !options.harness_fix) {
    throw new RunError(`usage: node run.cjs ${name} --accept --harness-fix <sha> [--tree <dir>] [--config <file>]`, 'BAD_ARGS', 1);
  }
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const lane = laneOf(config, name, options.config);
  const base = options.base || resolveBase(config, null, tree);
  const sha = lib.git(tree, ['rev-parse', '--verify', '--quiet', `${options.harness_fix}^{commit}`], { tolerate: true });
  const refs = [base, `origin/${base}`].filter((ref) => lib.git(tree, ['rev-parse', '--verify', '--quiet', ref], { tolerate: true }));
  if (!sha || !refs.some((ref) => lib.git(tree, ['merge-base', '--is-ancestor', sha, ref], { tolerate: true }) !== null)) {
    throw new RunError(`harness fix ${options.harness_fix} is not on ${base}: land the harness fix on ${base} first, then accept its sha.`, 'NOT_ON_BASE');
  }
  const proof = laneProof(tree, options.config, lane);
  const last = jobs.readJson(jobs.jobPaths(tree, name).result);
  if (!last || last.lane !== name || last.result !== 'instrument-red' || last.hash !== proof.hash || typeof last.run !== 'string') {
    throw new RunError(`no instrument red of the ${name} lane on this tree to accept: run ${gateStartCall(tree, options)}, ` +
      `then ${gateWaitCall(tree, options)}.`, 'NOTHING_TO_ACCEPT');
  }
  const { file, ...identity } = proof;
  writeRecord(`${file}${ACCEPTED}`, { ...identity, harness_fix: sha, run: last.run, code: last.code, stamp: new Date().toISOString(), branch: lib.currentBranch(tree) });
  return {
    exit: 0,
    payload: { accepted: true, lane: name, harness_fix: sha, hash: proof.hash },
    out: [
      `accepted ${name} instrument red against harness fix ${sha.slice(0, 7)} for this tree`,
      `wait with: ${gateWaitCall(tree, options)}`,
    ],
  };
}

/** What green owes for the smoke lane: nothing when unset or out of scope, else a green or accepted proof. */
function smokeOwed(tree, config, selected, changed) {
  const lane = configuredLanes(config).find((entry) => entry.name === 'smoke');
  if (!lane) return { owed: [], out: [`SKIP smoke (no verification.smoke in ${selected || DEFAULT_CONFIG})`] };
  if (!touched(lane, changed)) return { owed: [], out: ['SKIP smoke (no path in scope changed)'] };
  const proof = laneProof(tree, selected, lane);
  if (proofs.readProof(proof)) return { owed: [], out: [] };
  const accepted = readAccepted(tree, 'smoke', proof);
  if (accepted) return { owed: [], out: [`ACCEPTED smoke instrument red, harness fix ${accepted.harness_fix.slice(0, 7)}`] };
  return {
    owed: ['smoke'],
    out: [`smoke owed: no green or accepted instrument-red smoke run for this tree; run ${gateStartCall(tree, {})}, ` +
      `then ${gateWaitCall(tree, {})}`],
  };
}

module.exports = { accept, laneNow, laneProof, smokeOwed, startLanes, waitAll };
