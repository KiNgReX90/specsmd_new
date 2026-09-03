'use strict';

/**
 * Intent-level steps of `run.cjs`: select, claim, unclaim, worktree, frontier and the
 * dispatch log. Every ledger write goes through state-transition.cjs, the single writer.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const writer = require('./state-transition.cjs');
const scheduler = require('./team-scheduler.cjs');

const { RunError } = lib;

const CHEAP_KINDS = new Set(['test', 'docs-only', 'docs', 'config-only', 'config']);
const TERMINAL = new Set(['completed', 'done']);
/** The `TC-12` case-id convention a project's case list uses. */
const CASE_ID = /\bTC-\d+\b/g;

function isComplete(status) {
  return TERMINAL.has(status);
}

/** The branch an intent merges into: config first, then the intent's own record. */
function resolveBase(config, intent, root) {
  const configured = config.delivery && config.delivery.base_branch;
  if (configured) return configured;
  if (intent && intent.base_branch) return intent.base_branch;
  const head = lib.git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { tolerate: true });
  if (head) return head.replace(/^origin\//, '');
  return lib.currentBranch(root);
}

/** Prerequisite ids that have not shipped. An id the ledger cannot answer to is archived. */
function unmetPrerequisites(ledger, intent) {
  const known = new Map(ledger.intents.map((entry) => [entry.id, entry.status]));
  return intent.depends_on_intents.filter((id) => known.has(id) && !isComplete(known.get(id)));
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

function worktreeEntries(root) {
  const out = [];
  let current = null;
  for (const line of lib.gitLines(root, ['worktree', 'list', '--porcelain'], { tolerate: true })) {
    if (line.startsWith('worktree ')) current = { path: line.slice(9), branch: null };
    else if (line.startsWith('branch ') && current) current.branch = line.slice(7).replace('refs/heads/', '');
    if (current && !out.includes(current)) out.push(current);
  }
  return out;
}

function branchesFor(root, intentId) {
  return lib
    .gitLines(root, ['branch', '--list', `inferno-intent/${intentId}-*`, '--format=%(refname:short)'], { tolerate: true });
}

function worktreeFor(root, intentId) {
  return worktreeEntries(root).find(
    (entry) => entry.branch && entry.branch.startsWith(`inferno-intent/${intentId}-`)
  );
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
  const claimable = [];
  const blocked = [];
  const recovery = [];

  for (const intent of ledger.intents) {
    if (intent.status === 'pending') {
      const unmet = unmetPrerequisites(ledger, intent);
      const entry = { id: intent.id, title: intent.title, items: grades(intent) };
      if (unmet.length > 0) blocked.push({ ...entry, unmet });
      else claimable.push({ ...entry, cases: testerCases(root, intent) });
      continue;
    }
    if (intent.status !== 'in_progress') continue;

    const branch = branchesFor(root, intent.id);
    const tree = worktreeFor(root, intent.id);
    const live = tree ? lib.processesIn(tree.path) : null;
    let reason = null;
    if (branch.length === 0 && !tree) reason = 'branch and worktree are both gone';
    else if (!tree) reason = 'no worktree for the branch';
    else if (branch.length === 0) reason = 'no branch for the worktree';
    else if (live && live.length === 0) reason = 'no process running in the worktree';
    if (reason) {
      recovery.push({ id: intent.id, reason, tree: tree ? tree.path : null, check: checkLine(ledger.file, intent.id) });
    }
  }

  const out = [];
  out.push(claimable.length > 0 ? 'claimable' : 'no claimable intent');
  for (const entry of claimable) {
    out.push(`  ${entry.id}  ${entry.title}  ${entry.items}${entry.cases.length > 0 ? `  cases ${entry.cases.join(' ')}` : ''}`);
  }
  for (const entry of blocked) out.push(`blocked ${entry.id}  waiting on ${entry.unmet.join(', ')}`);
  for (const entry of recovery) out.push(`recover ${entry.id}  ${entry.reason}  ${entry.check}`);
  return { exit: 0, payload: { claimable, blocked, recovery }, out };
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

function claim(intentId, options) {
  const root = lib.primaryRoot(options.cwd);
  const config = lib.readConfig(root);
  const ledger = lib.readLedger(root);
  const intent = lib.findIntent(ledger, intentId);
  const base = resolveBase(config, intent, root);
  const branch = lib.currentBranch(root);

  if (branch !== base) {
    throw new RunError(`the primary checkout is on ${branch}, not the base branch ${base}. Switch it back first.`, 'NOT_ON_BASE');
  }
  const dirty = lib.dirtyPaths(root, [`${lib.SPECS_DIR}/`]);
  if (dirty.length > 0) {
    throw new RunError(
      `the primary checkout carries changes outside ${lib.SPECS_DIR}: ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ` and ${dirty.length - 5} more` : ''}`,
      'DIRTY'
    );
  }

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
  const config = lib.readConfig(root);
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
  const config = lib.readConfig(root);
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
// frontier
// ---------------------------------------------------------------------------

function tierOf(item) {
  return item.complexity === 'low' || CHEAP_KINDS.has(item.kind) ? 'cheap' : 'strong';
}

function loadItems(tree, intent) {
  return intent.items
    .filter((item) => !isComplete(item.status))
    .map((item) => {
      const spec = lib.readItemSpec(tree, intent.id, item.id);
      const manifest = spec.manifest || {};
      return {
        id: item.id,
        kind: item.kind || String(spec.frontmatter.kind || '').toLowerCase(),
        complexity: item.complexity || String(spec.frontmatter.complexity || '').toLowerCase(),
        depends_on: item.depends_on,
        context: manifest.context || {},
        ownership: manifest.ownership || {},
        file: spec.file,
      };
    });
}

/** The contract check, plus the one team-scheduler cannot make: the paths have to exist. */
function contractErrors(tree, items) {
  const errors = [];
  for (const item of items) {
    errors.push(...scheduler.validateWorkItem(item).errors);
    for (const entry of item.context.required || []) {
      const target = entry && entry.path;
      if (target && !fs.existsSync(path.join(tree, target))) {
        errors.push(`${item.id}: context.required path does not exist: ${target}`);
      }
    }
  }
  return errors;
}

function frontier(intentId, options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const ledger = lib.readLedger(tree);
  const intent = lib.findIntent(ledger, intentId);
  const items = loadItems(tree, intent);

  const errors = contractErrors(tree, items);
  if (errors.length > 0) {
    return { exit: 2, payload: { ok: false, errors }, out: errors.map((error) => `INVALID ${error}`) };
  }

  const completedIds = new Set(intent.items.filter((item) => isComplete(item.status)).map((item) => item.id));
  const ready = items.filter((item) => item.depends_on.every((id) => completedIds.has(id)));
  const waiting = items.filter((item) => !ready.includes(item));
  const owns = (item) => item.ownership.editable || [];

  const serialize = [];
  for (let i = 0; i < ready.length; i += 1) {
    for (let j = i + 1; j < ready.length; j += 1) {
      const shared = owns(ready[i]).filter((entry) => owns(ready[j]).includes(entry));
      if (shared.length > 0) serialize.push({ items: [ready[i].id, ready[j].id], shared });
    }
  }

  const dispatch = scheduler
    .selectDispatchableItems(ready, { completedIds })
    .map((item) => item.id);

  // A batch is only a saving when the items could not have run in parallel anyway: same
  // tier, low complexity, and ownership nothing else in the frontier touches.
  const alone = (item) =>
    owns(item).every((entry) => !ready.some((other) => other !== item && owns(other).includes(entry)));
  const batch = [];
  let group = [];
  for (const item of ready) {
    const eligible = item.complexity === 'low' && alone(item);
    if (eligible && (group.length === 0 || tierOf(group[0]) === tierOf(item))) group.push(item);
    else {
      if (group.length > 1) batch.push(group.map((entry) => entry.id));
      group = eligible ? [item] : [];
    }
  }
  if (group.length > 1) batch.push(group.map((entry) => entry.id));

  const shape = (item) => ({ id: item.id, complexity: item.complexity, kind: item.kind, tier: tierOf(item) });
  const out = ready.map((item) => `ready ${item.id} ${item.complexity} ${item.kind || 'unset'} ${tierOf(item)}`);
  for (const item of waiting) out.push(`waiting ${item.id} on ${item.depends_on.join(', ')}`);
  for (const pair of serialize) out.push(`serialize ${pair.items.join(' + ')} (shares ${pair.shared.join(', ')})`);
  for (const group2 of batch) out.push(`batch ${group2.join(',')}`);
  if (out.length === 0) out.push('no item left in this intent');
  return {
    exit: 0,
    payload: { ready: ready.map(shape), waiting: waiting.map(shape), serialize, dispatch, batch },
    out,
  };
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
