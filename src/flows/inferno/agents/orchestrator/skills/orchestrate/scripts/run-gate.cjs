'use strict';

/**
 * The verification steps of `run.cjs`: one item's own check, the finalize gate, and the
 * green marker that lets a later step know this exact code already passed it.
 *
 * The marker is keyed on the code tree rather than on the commit, so the bookkeeping commit
 * a run makes after a green gate does not cost a second full gate. That second pass was
 * measured at 25 to 30 extra minutes per intent in a production repo.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const lib = require('./run-lib.cjs');
const { resolveBase } = require('./run-intents.cjs');

const { RunError } = lib;

function treeOf(options) {
  return options.tree || lib.repoRoot(options.cwd);
}

function refuseDirty(tree) {
  const dirty = lib.dirtyPaths(tree);
  if (dirty.length > 0) {
    throw new RunError(
      `refusing to verify a dirty tree: ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ` and ${dirty.length - 5} more` : ''}. Commit or discard first.`,
      'DIRTY'
    );
  }
}

function markerFile(tree) {
  return path.join(lib.cacheDir(tree), 'green', lib.codeTreeHash(tree));
}

/** Paths this branch changed against the base branch, and what is uncommitted on top. */
function changedPaths(tree, since) {
  const tracked = lib.gitLines(tree, ['diff', '--name-only', since], { tolerate: true });
  const untracked = lib.gitLines(tree, ['ls-files', '--others', '--exclude-standard'], { tolerate: true });
  return [...new Set([...tracked, ...untracked])];
}

function mergeBase(tree, base) {
  return lib.git(tree, ['merge-base', 'HEAD', base], { tolerate: true }) || base;
}

// ---------------------------------------------------------------------------
// verify-item
// ---------------------------------------------------------------------------

function ownedBy(file, editable) {
  return editable.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

function verifyItem(itemId, options) {
  const tree = treeOf(options);
  const ledger = lib.readLedger(tree);
  const intent = options.intent
    ? lib.findIntent(ledger, options.intent)
    : ledger.intents.find((entry) => entry.items.some((item) => item.id === itemId));
  if (!intent) throw new RunError(`work item not found in the live ledger: ${itemId}`, 'ITEM_NOT_FOUND');

  const spec = lib.readItemSpec(tree, intent.id, itemId);
  const editable = (spec.manifest.ownership && spec.manifest.ownership.editable) || [];
  const config = lib.readConfig(tree);
  const since = options.since || mergeBase(tree, resolveBase(config, intent, tree));
  const outside = changedPaths(tree, since).filter(
    (file) => !file.startsWith(`${lib.SPECS_DIR}/`) && !ownedBy(file, editable)
  );

  const out = [];
  let failed = outside.length > 0;
  let check = null;
  if (spec.manifest.finalize_check) {
    const log = path.join(lib.cacheDir(tree), lib.currentBranch(tree), `verify-${itemId}-${lib.stamp()}.log`);
    check = lib.runShell(spec.manifest.finalize_check, tree, log);
    out.push(
      check.code === 0
        ? `PASS ${check.seconds}s ${check.command}`
        : `FAIL ${check.seconds}s ${check.command} -> ${log}`
    );
    if (check.code !== 0) {
      out.push(...lib.tail(log, 5));
      failed = true;
    }
  } else {
    out.push(`PASS ${itemId} carries no finalize_check`);
  }

  if (outside.length > 0) {
    out.push(`outside ${itemId} ownership.editable: ${outside.slice(0, 10).join(', ')}`);
  } else {
    out.push(`ownership clean since ${since}`);
  }

  return {
    exit: failed ? 2 : 0,
    payload: { item: itemId, intent: intent.id, since, outside, check },
    out,
  };
}

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------

/** The human lines for a gate's results, the same whether run here or read from a finished job. */
function describe(results) {
  const out = [];
  for (const entry of results) {
    if (entry.result === 'skip') out.push(`SKIP ${entry.command} (no path in scope changed)`);
    else if (entry.result === 'pass') out.push(`PASS ${entry.seconds}s ${entry.command}`);
    else {
      out.push(`FAIL ${entry.seconds}s ${entry.command} -> ${entry.log}`);
      out.push(...lib.tail(entry.log, 5));
    }
  }
  return out;
}

function gateCommands(tree) {
  const config = lib.readConfig(tree);
  const commands = (config.verification && config.verification.finalize) || [];
  if (commands.length === 0) {
    throw new RunError(
      `no verification.finalize list in ${lib.SPECS_DIR}/config.yaml: the gate has nothing to run`,
      'NO_GATE'
    );
  }
  return { config, commands };
}

/** Run the finalize commands in this process. `gate` below dispatches between this, --detach and --wait. */
function gateNow(options) {
  const tree = treeOf(options);
  refuseDirty(tree);
  const { config, commands } = gateCommands(tree);

  const base = options.base || resolveBase(config, null, tree);
  const scopes = (config.verification && config.verification.finalize_scopes) || {};
  const changed = lib.gitLines(tree, ['diff', '--name-only', `${mergeBase(tree, base)}..HEAD`], { tolerate: true });
  const branch = lib.currentBranch(tree);
  const dir = path.join(lib.cacheDir(tree), branch, `gate-${lib.stamp()}`);

  const results = [];
  for (const [index, command] of commands.entries()) {
    const scope = scopes[command];
    if (scope && !changed.some((file) => lib.matchesAny(file, scope))) {
      results.push({ command, result: 'skip' });
      continue;
    }
    const run = lib.runShell(command, tree, path.join(dir, `${index}.log`));
    if (run.code === 0) {
      results.push({ command, result: 'pass', seconds: run.seconds });
      continue;
    }
    results.push({ command, result: 'fail', seconds: run.seconds, log: run.log });
    return { exit: 2, payload: { ok: false, tree, branch, results }, out: describe(results) };
  }

  const marker = markerFile(tree);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${new Date().toISOString()}\n${branch}\n${commands.join('\n')}\n`, 'utf8');
  return {
    exit: 0,
    payload: { ok: true, tree, branch, results, marker },
    out: [...describe(results), `green ${path.basename(marker)}`],
  };
}

// ---------------------------------------------------------------------------
// gate --detach / gate --wait
//
// The gate outruns the ten-minute cap a host puts on one tool call, and a background tool
// call is orphaned the moment a headless run ends its turn (2026-09-03: the orchestrator
// wrote "I'll continue when it exits" and the process exited with it, gate and all). So the
// gate runs as its own detached process and the orchestrator blocks on it in slices that fit
// the cap: `--wait` exits 0 green, 2 red, 4 still running, and 4 means call it again.
// ---------------------------------------------------------------------------

function jobPaths(tree) {
  const dir = path.join(lib.cacheDir(tree), lib.currentBranch(tree));
  return {
    job: path.join(dir, 'gate-job.json'),
    result: path.join(dir, 'gate-job.result.json'),
    log: path.join(dir, 'gate-job.log'),
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

/** Is the job's process still the gate we started, and still running. */
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

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitCommand(tree) {
  return `node ${path.join(__dirname, 'run.cjs')} gate --wait --tree ${tree}`;
}

function gateDetach(options) {
  const tree = treeOf(options);
  refuseDirty(tree);
  gateCommands(tree);
  const paths = jobPaths(tree);
  const existing = readJson(paths.job);
  if (alive(existing)) {
    throw new RunError(
      `a gate is already running for this tree (pid ${existing.pid}, started ${existing.started}); wait for it: ${waitCommand(tree)}`,
      'GATE_RUNNING'
    );
  }

  fs.mkdirSync(path.dirname(paths.job), { recursive: true });
  const args = [path.join(__dirname, 'run.cjs'), 'gate', '--tree', tree, '--json'];
  if (options.base) args.push('--base', options.base);
  const out = fs.openSync(paths.result, 'w');
  const err = fs.openSync(paths.log, 'w');
  const child = spawn(process.execPath, args, { cwd: tree, detached: true, stdio: ['ignore', out, err] });
  fs.closeSync(out);
  fs.closeSync(err);
  child.unref();

  const job = { pid: child.pid, started: new Date().toISOString(), tree, branch: lib.currentBranch(tree), ...paths };
  fs.writeFileSync(paths.job, `${JSON.stringify(job)}\n`, 'utf8');
  return {
    exit: 0,
    payload: { started: true, ...job },
    out: [`gate started pid ${child.pid}`, `log ${paths.log}`, `wait with: ${waitCommand(tree)}`],
  };
}

function finished(job) {
  const result = readJson(job.result);
  if (result && Array.isArray(result.results)) {
    const out = describe(result.results);
    if (result.ok) out.push(`green ${path.basename(result.marker)}`);
    return { exit: result.ok ? 0 : 2, payload: result, out };
  }
  return {
    exit: 2,
    payload: { ok: false, tree: job.tree, branch: job.branch, results: [], died: true },
    out: [`gate process ${job.pid} ended without a result -> ${job.log}`, ...lib.tail(job.log, 5)],
  };
}

function gateWait(options) {
  const tree = treeOf(options);
  const job = readJson(jobPaths(tree).job);
  if (!job) {
    throw new RunError('no gate has been started for this tree; start one with gate --detach', 'NO_GATE_JOB');
  }
  const deadline = Date.now() + Number(options.minutes || 9) * 60000;
  while (alive(job)) {
    if (Date.now() >= deadline) {
      const elapsed = Math.round((Date.now() - Date.parse(job.started)) / 60000);
      return {
        exit: 4,
        payload: { running: true, ...job, elapsed_minutes: elapsed },
        out: [`gate still running pid ${job.pid}, ${elapsed} min so far`, `log ${job.log}`, 'call gate --wait again'],
      };
    }
    sleepSync(500);
  }
  return finished(job);
}

function gate(options) {
  if (options.detach && options.wait) throw new RunError('gate takes --detach or --wait, not both', 'BAD_ARGS', 1);
  if (options.detach) return gateDetach(options);
  if (options.wait) return gateWait(options);
  return gateNow(options);
}

// ---------------------------------------------------------------------------
// green
// ---------------------------------------------------------------------------

function green(options) {
  const tree = treeOf(options);
  refuseDirty(tree);
  const hash = lib.codeTreeHash(tree);
  const marker = path.join(lib.cacheDir(tree), 'green', hash);
  if (fs.existsSync(marker)) {
    return { exit: 0, payload: { green: true, hash, marker }, out: [`green ${hash}`, `marker ${marker}`] };
  }
  return {
    exit: 3,
    payload: { green: false, hash },
    out: [`no green marker for ${hash}`, 'run gate first'],
  };
}

module.exports = { changedPaths, gate, green, mergeBase, verifyItem };
