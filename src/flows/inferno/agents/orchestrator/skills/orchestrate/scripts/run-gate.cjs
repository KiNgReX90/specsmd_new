'use strict';

/** Verification commands retain a proof for each unchanged scope. */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const { attribute } = require('./run-attribute.cjs');
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

/** Paths changed since a ref (the branch against its base, or the tree against HEAD), and what is uncommitted on top. */
function changedPaths(tree, since) {
  const tracked = lib.gitLines(tree, ['diff', '--name-only', since], { tolerate: true });
  const untracked = lib.gitLines(tree, ['ls-files', '--others', '--exclude-standard'], { tolerate: true });
  return [...new Set([...tracked, ...untracked])];
}

function mergeBase(tree, base) {
  return lib.git(tree, ['merge-base', 'HEAD', base], { tolerate: true }) || base;
}

/**
 * Fold the base branch into the worktree before the gate runs, so the tree the gate proves is
 * the tree ship merges. Without it every intent whose base moved while it was open paid two
 * gates: one here, one after ship folded the base in and found the marker stale (2026-09-03).
 * Commits that reached origin but not the local base are folded too. A conflict stops here with
 * the files named and the merge left in the worktree to resolve.
 */
function foldBase(tree, base) {
  const branch = lib.currentBranch(tree);
  const before = lib.git(tree, ['rev-parse', 'HEAD']);
  const refs = [base];
  if (lib.git(tree, ['remote'], { tolerate: true })) {
    lib.git(tree, ['fetch', '--quiet', 'origin', base], { tolerate: true });
    if (lib.git(tree, ['rev-parse', '--verify', '--quiet', `origin/${base}`], { tolerate: true })) refs.push(`origin/${base}`);
  }
  for (const ref of refs) {
    if (lib.git(tree, ['merge', '--no-edit', ref], { tolerate: true }) === null) {
      const conflicts = lib.gitLines(tree, ['diff', '--name-only', '--diff-filter=U'], { tolerate: true });
      throw new RunError(
        `conflict folding ${ref} into ${branch}: ${conflicts.slice(0, 10).join(', ')}. ` +
          'Resolve them in the worktree so both sides\' goals survive, commit, then run the step again.',
        'FOLD_CONFLICT'
      );
    }
  }
  return lib.git(tree, ['rev-parse', 'HEAD']) === before ? [] : [`folded ${base} into ${branch}`];
}

// ---------------------------------------------------------------------------
// verify-item
// ---------------------------------------------------------------------------

/** The items under review: one id, or the explicitly batched chain in `--items a,b`. */
function reviewed(ledger, itemId, options) {
  const ids = options.items
    ? String(options.items).split(',').map((id) => id.trim()).filter((id) => id.length > 0)
    : [itemId];
  return ids.map((id) => {
    const intent = options.intent
      ? lib.findIntent(ledger, options.intent)
      : ledger.intents.find((entry) => entry.items.some((item) => item.id === id));
    if (!intent) throw new RunError(`work item not found in the live ledger: ${id}`, 'ITEM_NOT_FOUND');
    return { id, intent: intent.id };
  });
}

/** Every path changed since `since` that the union of the reviewed items does not own. */
function sinceOutside(tree, since, editable) {
  return changedPaths(tree, since).filter(
    (file) => !file.startsWith(`${lib.SPECS_DIR}/`) && !lib.ownedBy(file, editable, tree)
  );
}

/**
 * One item's own check plus its ownership. A batch is reviewed as the unit it was built as:
 * each item against its own dispatch, so a change one item of the batch reported is that
 * item's, and under `--since` against the union of its items' editable lists.
 */
function verifyItem(itemId, options) {
  const tree = treeOf(options);
  const ledger = lib.readLedger(tree);
  const items = reviewed(ledger, itemId, options).map((entry) => ({
    ...entry,
    spec: lib.readItemSpec(tree, entry.intent, entry.id),
  }));
  const label = items.map((entry) => entry.id).join(', ');
  const editable = [
    ...new Set(
      items.flatMap((entry) => (entry.spec.manifest.ownership && entry.spec.manifest.ownership.editable) || [])
    ),
  ];
  // `--since` names the baseline by hand; without it each item answers to its own dispatch,
  // and an item the runner before signed records dispatched is checked the old way.
  const out = [];
  let attribution = options.since ? null
    : attribute(tree, items, { ...options, base: options.base || resolveBase(lib.readConfig(tree, options.config), null, tree) });
  if (attribution && attribution.legacy) {
    out.push(`no signed dispatch for ${attribution.legacy.join(', ')}: checked since HEAD as the runner before signed records did`);
    attribution = null;
  }
  const since = attribution ? attribution.since : options.since || 'HEAD';
  const outside = attribution ? attribution.outside : sinceOutside(tree, since, editable);
  const unreported = attribution ? attribution.unreported : [];
  const attributed = attribution ? attribution.attributed : [];
  let failed = outside.length > 0;
  const checks = [];
  for (const entry of items) {
    if (!entry.spec.manifest.finalize_check) {
      out.push(`PASS ${entry.id} carries no finalize_check`);
      continue;
    }
    const log = path.join(lib.cacheDir(tree), lib.currentBranch(tree), `verify-${entry.id}-${lib.stamp()}.log`);
    const check = lib.runShell(entry.spec.manifest.finalize_check, tree, log);
    checks.push({ item: entry.id, ...check });
    out.push(
      check.code === 0
        ? `PASS ${check.seconds}s ${check.command}`
        : `FAIL ${check.seconds}s ${check.command} -> ${log}`
    );
    if (check.code !== 0) {
      out.push(...lib.tail(log, 5));
      failed = true;
    }
  }

  if (outside.length > 0) {
    out.push(`outside ${label} ownership.editable: ${outside.slice(0, 10).join(', ')}`);
  } else {
    out.push(`ownership clean since ${since}`);
  }
  if (unreported.length > 0) {
    out.push(`owned but not in changed_files: ${unreported.slice(0, 10).join(', ')}. If this item wrote them, run dispatch-log ` +
      'for it again and accept-dispatch its full list, or each sibling\'s review names them outside');
  }

  return {
    exit: failed ? 2 : 0,
    payload: { items: items.map((entry) => entry.id), item: items[0].id, intent: items[0].intent, since, outside, unreported, checks, dispatches: attributed },
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
    else if (entry.result === 'green') out.push(`GREEN ${entry.seconds}s ${entry.command} (unchanged since ${entry.stamp})`);
    else if (entry.result === 'pass') out.push(`PASS ${entry.seconds}s ${entry.command}`);
    else if (entry.result === 'flake') {
      out.push(`FLAKE ${entry.seconds}s ${entry.command} -> ${entry.log}`);
      out.push(...entry.cases.map((name) => `  ${name}`));
    }
    else {
      out.push(`FAIL ${entry.seconds}s ${entry.command} -> ${entry.log}`);
      out.push(...lib.tail(entry.log, 5));
      if (entry.rerunLog) {
        out.push(`FAIL rerun ${entry.rerunCommand} -> ${entry.rerunLog}`);
        out.push(...lib.tail(entry.rerunLog, 5));
      }
    }
  }
  return out;
}

/** The Playwright failure summary names the cases after its count, before the pass count. */
function failedCases(log) {
  const lines = fs.readFileSync(log, 'utf8').split('\n');
  const summary = lines.findIndex((line) => /^  \d+ failed(?: \([^)]+\))?\s*$/.test(line));
  if (summary < 0) return [];
  const cases = [];
  for (const line of lines.slice(summary + 1)) {
    if (!/^    \[[^\]]+\] › .+/.test(line)) break;
    cases.push(line.trim());
  }
  return cases;
}

/** A passing rerun proves the original command only while its inputs remain unchanged. */
function recordFlake(tree, config, selected, command, seconds) {
  const { file, ...identity } = proofs.commandProof(tree, config, selected, command);
  const record = { ...identity, stamp: new Date().toISOString(), seconds, branch: lib.currentBranch(tree) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(pending, `${JSON.stringify(record)}\n`);
  fs.renameSync(pending, file);
}

function gateCommands(tree, selected) {
  const config = lib.readConfig(tree, selected);
  const commands = (config.verification && config.verification.finalize) || [];
  if (commands.length === 0) {
    throw new RunError(
      `no verification.finalize list in ${selected || `${lib.SPECS_DIR}/config.yaml`}: the gate has nothing to run`,
      'NO_GATE'
    );
  }
  return { config, commands };
}

/** Run the finalize commands in this process. `gate` below dispatches between this, --detach and --wait. */
function gateNow(options) {
  const tree = treeOf(options);
  refuseDirty(tree);
  const initial = gateCommands(tree, options.config);
  const base = options.base || resolveBase(initial.config, null, tree);
  const folded = foldBase(tree, base);
  const { config, commands } = gateCommands(tree, options.config);
  // Reject a verdict if the inputs change while the gate runs.
  const codeHash = lib.codeTreeHash(tree);
  const head = lib.git(tree, ['rev-parse', 'HEAD']);
  const started = proofs.scopeHash(tree);
  const definition = JSON.stringify(config.verification);
  const branch = lib.currentBranch(tree);
  const dir = path.join(lib.cacheDir(tree), branch, `gate-${lib.stamp()}`);

  const results = [];
  const unchanged = () => lib.git(tree, ['rev-parse', 'HEAD']) === head &&
    lib.dirtyPaths(tree).length === 0 && proofs.scopeHash(tree) === started &&
    JSON.stringify(lib.readConfig(tree, options.config).verification) === definition;
  for (const [index, command] of commands.entries()) {
    const result = proofs.runCommand(tree, config, options.config, command, path.join(dir, `${index}.log`), Boolean(options.force));
    const rerunCommand = config.verification.flake_rerun && config.verification.flake_rerun[command];
    if (result.result === 'fail' && rerunCommand) {
      if (unchanged()) {
        const rerun = lib.runShell(rerunCommand, tree, path.join(dir, `${index}-rerun.log`));
        result.rerunCommand = rerunCommand;
        result.rerunLog = rerun.log;
        result.seconds += rerun.seconds;
        if (rerun.code === 0 && unchanged()) {
          recordFlake(tree, config, options.config, command, result.seconds);
          result.cases = failedCases(result.log);
          result.result = 'flake';
        } else if (!unchanged()) result.moved = true;
      } else result.moved = true;
    }
    results.push(result);
    if (result.result === 'fail') {
      const out = [...folded, ...describe(results)];
      if (result.moved) out.push('the code changed while the gate ran. Re-run the gate.');
      return { exit: 2, payload: { ok: false, tree, branch, folded: folded.length > 0, results }, out };
    }
  }

  if (proofs.scopeHash(tree) !== started ||
      JSON.stringify(lib.readConfig(tree, options.config).verification) !== definition) {
    const out = [...folded, ...describe(results), 'the code changed while the gate ran. Re-run the gate.'];
    return { exit: 2, payload: { ok: false, tree, branch, folded: folded.length > 0, results, moved: true }, out };
  }

  return {
    exit: 0,
    payload: { ok: true, tree, branch, folded: folded.length > 0, results, hash: codeHash },
    out: [...folded, ...describe(results), `green ${codeHash}`],
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

function waitCommand(tree, config) {
  return `node ${path.join(__dirname, 'run.cjs')} gate --wait --tree ${tree}${config ? ` --config ${config}` : ''}`;
}

function gateDetach(options) {
  const tree = treeOf(options);
  refuseDirty(tree);
  const { config } = gateCommands(tree, options.config);
  const paths = jobPaths(tree);
  const existing = readJson(paths.job);
  if (alive(existing)) {
    throw new RunError(
      `a gate is already running for this tree (pid ${existing.pid}, started ${existing.started}); wait for it: ${waitCommand(tree, options.config)}`,
      'GATE_RUNNING'
    );
  }

  const folded = foldBase(tree, options.base || resolveBase(config, null, tree));
  fs.mkdirSync(path.dirname(paths.job), { recursive: true });
  const args = [path.join(__dirname, 'run.cjs'), 'gate', '--tree', tree, '--json'];
  if (options.base) args.push('--base', options.base);
  if (options.config) args.push('--config', options.config);
  if (options.force) args.push('--force');
  const out = fs.openSync(paths.result, 'w');
  const err = fs.openSync(paths.log, 'w');
  const child = spawn(process.execPath, args, { cwd: tree, detached: true, stdio: ['ignore', out, err] });
  fs.closeSync(out);
  fs.closeSync(err);
  child.unref();

  const job = { pid: child.pid, config: options.config || `${lib.SPECS_DIR}/config.yaml`, started: new Date().toISOString(), tree, branch: lib.currentBranch(tree), ...paths };
  fs.writeFileSync(paths.job, `${JSON.stringify(job)}\n`, 'utf8');
  return {
    exit: 0,
    payload: { started: true, folded: folded.length > 0, ...job },
    out: [...folded, `gate started pid ${child.pid}`, `log ${paths.log}`, `result ${paths.result}`, `wait with: ${waitCommand(tree, options.config)}`],
  };
}

function finished(job) {
  const result = readJson(job.result);
  if (result && Array.isArray(result.results)) {
    const out = describe(result.results);
    if (result.ok) out.push(`green ${result.hash}`);
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
  const selected = path.resolve(tree, options.config || `${lib.SPECS_DIR}/config.yaml`);
  const configured = path.resolve(tree, job.config || `${lib.SPECS_DIR}/config.yaml`);
  if (selected !== configured) {
    throw new RunError(`the started gate uses config ${job.config}. Wait with the same --config file.`, 'GATE_CONFIG');
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
  const { config, commands } = gateCommands(tree, options.config);
  const hash = lib.codeTreeHash(tree);
  const missing = commands.filter((command) => !proofs.readProof(proofs.commandProof(tree, config, options.config, command)));
  return missing.length === 0
    ? { exit: 0, payload: { green: true, hash }, out: [`green ${hash}`] }
    : { exit: 3, payload: { green: false, hash, missing }, out: [`no green marker for ${hash}`, 'run gate first'] };
}

module.exports = {
  changedPaths,
  describe,
  foldBase,
  gate,
  green,
  mergeBase,
  refuseDirty,
  treeOf,
  verifyItem,
};
