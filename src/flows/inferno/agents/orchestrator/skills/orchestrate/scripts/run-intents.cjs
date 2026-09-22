'use strict';

/**
 * Intent-level steps of `run.cjs`: select, claim, unclaim, worktree and the dispatch log.
 * Every ledger write goes through state-transition.cjs, the single writer.
 *
 * `frontier` is the sixth step and lives in run-frontier.cjs, which is the item graph rather
 * than the intent. It is re-exported here so `run.cjs` keeps one intent-level module.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');
const writer = require('./state-transition.cjs');
const { frontier, tierOf } = require('./run-frontier.cjs');
const { archivePaths, archivedIds } = require('./state-archive.cjs');
const { PARKED_VALUES } = require('./state-ledger.cjs');
const { branchesFor, leftoverWorktrees, worktreeFor } = require('./run-worktrees.cjs');
const { ownership } = require('./run-owner.cjs');

/** An in_progress intent counts as abandoned after this long with no process, edit or commit in its worktree. */
const DEFAULT_IDLE_MINUTES = 60;

const { RunError } = lib;
// The completion vocabulary the ledger itself uses, rather than a second copy of it here.
const { isComplete } = writer;

/** The `TC-12` case-id convention a project's case list uses. */
const CASE_ID = /\bTC-\d+\b/g;

/** The branch an intent merges into: config first, then the intent's own record. */
function resolveBase(config, intent, root) {
  const configured = config.delivery && config.delivery.base_branch;
  if (configured) return configured;
  if (intent && intent.base_branch) return intent.base_branch;
  const head = lib.git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { tolerate: true });
  if (head) return head.replace(/^origin\//, '');
  return lib.currentBranch(root);
}

/**
 * Prerequisite ids that have not shipped. A shipped prerequisite answers from the archive, and
 * an id neither the ledger nor the archive knows is a name nobody planned, so it blocks too.
 */
function unmetPrerequisites(ledger, intent) {
  const known = new Map(ledger.intents.map((entry) => [entry.id, entry.status]));
  const archived = archivedIds(archivePaths(ledger.file).archiveFile);
  return intent.depends_on_intents.filter((id) =>
    known.has(id) ? !isComplete(known.get(id)) : !archived.has(id)
  );
}

function grades(intent) {
  const open = intent.items.filter((item) => !isComplete(item.status));
  const counted = ['low', 'medium', 'high']
    .map((grade) => [grade, open.filter((item) => item.complexity === grade).length])
    .filter(([, count]) => count > 0)
    .map(([grade, count]) => `${count} ${grade}`);
  return `${open.length} items${counted.length > 0 ? `: ${counted.join(', ')}` : ''}`;
}

/** Tester cases the intent names, from its ledger field or from its own prose. */
function testerCases(root, intent) {
  if (intent.tester_cases.length > 0) return intent.tester_cases;
  const brief = path.join(root, lib.SPECS_DIR, 'intents', intent.id, 'brief.md');
  const prose = intent.comment + (fs.existsSync(brief) ? fs.readFileSync(brief, 'utf8') : '');
  return [...new Set(prose.match(CASE_ID) || [])];
}

/** What `check` says about one intent, in one line. */
function checkLine(file, intentId) {
  try {
    const result = writer.check({ file, intent: intentId });
    if (result.drift.length === 0) return `ledger consistent across ${result.intents} intent(s)`;
    return `DRIFT ${result.drift[0].detail}`;
  } catch (error) {
    return `check failed: ${error.message}`;
  }
}

// ---------------------------------------------------------------------------
// select
// ---------------------------------------------------------------------------

function select(options) {
  const root = lib.primaryRoot(options.cwd);
  const ledger = lib.readLedger(root);
  const config = lib.readConfig(root, options.config);
  const idleWindow = Number((config.recovery || {}).idle_minutes) || DEFAULT_IDLE_MINUTES;
  const claimable = [];
  const blocked = [];
  const parked = [];
  const recovery = [];
  const running = [];

  for (const intent of ledger.intents) {
    if (intent.status === 'pending') {
      const unmet = unmetPrerequisites(ledger, intent);
      const entry = { id: intent.id, title: intent.title, items: grades(intent) };
      if (unmet.length > 0) blocked.push({ ...entry, unmet });
      else claimable.push({ ...entry, cases: testerCases(root, intent) });
      continue;
    }
    // A parked intent exists and cannot be built yet. It used to fall through this loop and
    // appear nowhere, so a blocked intent was as invisible as one nobody had captured. It
    // belongs in the listing and never in `claimable`. It is a bucket of its own because a
    // `blocked` entry above carries prerequisite ids that clear themselves, and this carries
    // free text and clears only when a person runs unblock-intent.
    if (PARKED_VALUES.has(intent.status)) {
      parked.push({
        id: intent.id,
        title: intent.title,
        status: intent.status,
        reason: intent.blocked_reason || '',
      });
      continue;
    }
    if (intent.status !== 'in_progress') continue;

    const branch = branchesFor(root, intent.id);
    const tree = worktreeFor(root, intent.id);
    let reason = null;
    if (branch.length === 0 && !tree) reason = 'branch and worktree are both gone';
    else if (!tree) reason = 'no worktree for the branch';
    else if (branch.length === 0) reason = 'no branch for the worktree';
    else {
      // A live session or a live detached gate owns the tree, however idle the worktree looks:
      // a gate works from the cache dir and its integration suite commits nothing for forty
      // minutes, which is exactly what an abandoned tree looks like from here (2026-09-10).
      const owner = ownership(tree.path);
      if (owner) {
        running.push({ id: intent.id, tree: tree.path, ...owner });
        continue;
      }
      const live = lib.processesIn(tree.path);
      const idle = lib.idleMinutes(tree.path);
      const busy = (live && live.length > 0) || (idle !== null && idle < idleWindow);
      if (!busy && idle !== null) reason = `no process in the worktree and idle for ${idle} min`;
      else if (!busy && live && live.length === 0) reason = 'no process running in the worktree';
    }
    if (reason) {
      recovery.push({ id: intent.id, reason, tree: tree ? tree.path : null, check: checkLine(ledger.file, intent.id) });
    }
  }

  // A repository with no commit yet has no base to resolve and no worktree to have left behind.
  const base = lib.git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { tolerate: true }) === null
    ? null
    : resolveBase(config, null, root);
  const leftovers = base ? leftoverWorktrees(root, ledger, base) : [];

  const out = [];
  out.push(claimable.length > 0 ? 'claimable' : 'no claimable intent');
  for (const entry of claimable) {
    out.push(`  ${entry.id}  ${entry.title}  ${entry.items}${entry.cases.length > 0 ? `  cases ${entry.cases.join(' ')}` : ''}`);
  }
  for (const entry of blocked) out.push(`blocked ${entry.id}  waiting on ${entry.unmet.join(', ')}`);
  for (const entry of parked) {
    out.push(`parked ${entry.id}  ${entry.status}: ${entry.reason || 'no reason recorded'}`);
  }
  for (const entry of running) {
    out.push(
      entry.kind === 'session'
        ? `running ${entry.id}  owned by live session pid ${entry.pid}, last step ${entry.step} ${entry.minutes} min ago`
        : `running ${entry.id}  gate pid ${entry.pid} still running since ${entry.started}`
    );
  }
  for (const entry of recovery) out.push(`recover ${entry.id}  ${entry.reason}  ${entry.check}`);
  for (const entry of leftovers) {
    out.push(`leftover ${entry.id}  ${entry.path}  merged into ${base}; run teardown --tree ${entry.path}`);
  }
  return { exit: 0, payload: { claimable, blocked, parked, running, recovery, leftovers }, out };
}

// ---------------------------------------------------------------------------
// claim / unclaim
// ---------------------------------------------------------------------------

function stageAndCommit(root, intentId, message) {
  const paths = [path.join(lib.SPECS_DIR, 'state.yaml'), path.join(lib.SPECS_DIR, 'intents', intentId)]
    .filter((rel) => fs.existsSync(path.join(root, rel)));
  lib.git(root, ['add', '--', ...paths]);
  lib.git(root, ['commit', '-q', '-m', message]);
  return lib.git(root, ['rev-parse', '--short', 'HEAD']);
}

/**
 * The standing instruction a worker loads is paid on every round of every builder, and the
 * text only stops growing where a run refuses to start under it. One machine-level script
 * holds the ceilings for every repo on the box; a box without it claims as before.
 */
const FLOW_BUDGET = process.env.INFERNO_FLOW_BUDGET ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
    'specsmd-inferno', 'flow-text-budget.py');

function refuseOverBudget(root) {
  if (!fs.existsSync(FLOW_BUDGET)) return;
  const result = spawnSync('python3', [FLOW_BUDGET, '--repo', root, '--quiet'], { encoding: 'utf8' });
  if (result.error || result.status === null || result.status === 0) return;
  throw new RunError(
    `the flow text a worker loads is over its budget; a run cannot start under it.\n${result.stdout || ''}${result.stderr || ''}`.trim(),
    'FLOW_TEXT_OVER_BUDGET',
  );
}

function claim(intentId, options) {
  const root = lib.primaryRoot(options.cwd);
  const config = lib.readConfig(root, options.config);
  refuseOverBudget(root);
  const ledger = lib.readLedger(root);
  const intent = lib.findIntent(ledger, intentId);
  const base = resolveBase(config, intent, root);
  const branch = lib.currentBranch(root);

  if (branch !== base) {
    throw new RunError(`the primary checkout is on ${branch}, not the base branch ${base}. Switch it back first.`, 'NOT_ON_BASE');
  }
  // The primary checkout usually carries other sessions' edits; the claim stages only the ledger.

  const run = options.run || `inferno-intent/${intentId}-${lib.stamp()}`;
  const result = writer.claimIntent({ file: ledger.file, intent: intentId, run });
  if (!result.changed) {
    const sha = lib.git(root, ['rev-parse', '--short', 'HEAD']);
    return {
      exit: 0,
      payload: { claimed: false, intent: intentId, run: result.run, sha, note: result.note },
      out: [`${intentId} ${result.note} (${result.run})`],
    };
  }
  const sha = stageAndCommit(root, intentId, `specsmd(${intentId}): claim intent for run`);
  return {
    exit: 0,
    payload: { claimed: true, intent: intentId, run, base, sha },
    out: [`claimed ${intentId} on ${base} as ${run}`, `commit ${sha}`],
  };
}

function unclaim(intentId, options) {
  const root = lib.primaryRoot(options.cwd);
  const config = lib.readConfig(root, options.config);
  const ledger = lib.readLedger(root);
  const intent = lib.findIntent(ledger, intentId);
  const base = resolveBase(config, intent, root);

  for (const branch of branchesFor(root, intentId)) {
    const ahead = Number(lib.git(root, ['rev-list', '--count', `${base}..${branch}`], { tolerate: true }) || '0');
    if (ahead > 0) {
      throw new RunError(
        `refusing to unclaim ${intentId}: ${branch} carries ${ahead} commit(s) beyond the claim. Ship it or drop the branch first.`,
        'BRANCH_HAS_WORK'
      );
    }
  }

  const result = writer.unclaimIntent({ file: ledger.file, intent: intentId });
  if (!result.changed) {
    return { exit: 0, payload: { unclaimed: false, intent: intentId, note: result.note }, out: [`${intentId} ${result.note}`] };
  }
  const sha = stageAndCommit(root, intentId, `specsmd(${intentId}): release intent claim`);
  return { exit: 0, payload: { unclaimed: true, intent: intentId, sha }, out: [`unclaimed ${intentId}`, `commit ${sha}`] };
}

// ---------------------------------------------------------------------------
// worktree
// ---------------------------------------------------------------------------

function worktree(intentId, options) {
  const root = lib.primaryRoot(options.cwd);
  const config = lib.readConfig(root, options.config);
  const ledger = lib.readLedger(root);
  const intent = lib.findIntent(ledger, intentId);

  const open = worktreeFor(root, intentId);
  if (open) {
    return {
      exit: 0,
      payload: { created: false, path: open.path, branch: open.branch },
      out: [`resume ${open.path}`, `branch ${open.branch}`],
    };
  }

  const claimed = intent.claimed_by && intent.claimed_by.startsWith('inferno-intent/') ? intent.claimed_by : null;
  const branch = claimed || `inferno-intent/${intentId}-${lib.stamp()}`;
  const target = options.path || path.join(path.dirname(root), `${path.basename(root)}-inferno-${intentId}`);
  if (fs.existsSync(target)) throw new RunError(`refusing to open ${target}: the path already exists`, 'PATH_TAKEN');

  const exists = lib.git(root, ['rev-parse', '--verify', '--quiet', branch], { tolerate: true });
  lib.git(root, exists ? ['worktree', 'add', target, branch] : ['worktree', 'add', target, '-b', branch]);

  const out = [`worktree ${target}`, `branch ${branch}`];
  const bootstrap = (config.worktree && config.worktree.bootstrap) || [];
  for (const [index, command] of bootstrap.entries()) {
    const log = path.join(lib.cacheDir(root), 'bootstrap', `${intentId}-${index}.log`);
    const result = lib.runShell(command, target, log, { wrap: false });
    out.push(`bootstrap ${result.code === 0 ? 'PASS' : 'FAIL'} ${result.seconds}s ${command}`);
    if (result.code !== 0) {
      out.push(...lib.tail(log, 5));
      return { exit: 2, payload: { created: true, path: target, branch, bootstrap: 'failed', log }, out };
    }
  }

  const dirty = lib.dirtyPaths(target);
  if (dirty.length > 0) {
    out.push(`dirty after bootstrap: ${dirty.slice(0, 5).join(', ')}`);
    return { exit: 2, payload: { created: true, path: target, branch, dirty }, out };
  }
  return { exit: 0, payload: { created: true, path: target, branch }, out };
}

// ---------------------------------------------------------------------------
// dispatch-log
// ---------------------------------------------------------------------------

/**
 * The dispatch audit log the orchestrator keeps per run. It lives in the cache rather than
 * in the repo: it is a record of one run's dispatches, never work anyone builds from.
 */
function dispatchLog(intentId, options) {
  if (!options.item || !options.tier || !options.agent) {
    throw new RunError('dispatch-log requires --item, --tier and --agent', 'BAD_ARGS', 1);
  }
  const root = lib.primaryRoot(options.cwd);
  const log = path.join(lib.cacheDir(root), 'dispatch', `${intentId}.log`);
  const line = [new Date().toISOString(), intentId, options.item, options.tier, options.agent, options.batch || ''].join('\t');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, `${line}\n`, 'utf8');
  return { exit: 0, payload: { log, line }, out: [`logged ${options.item} -> ${log}`] };
}

module.exports = { claim, dispatchLog, frontier, resolveBase, select, tierOf, unclaim, worktree };
