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

function gate(options) {
  const tree = treeOf(options);
  refuseDirty(tree);
  const config = lib.readConfig(tree);
  const commands = (config.verification && config.verification.finalize) || [];
  if (commands.length === 0) {
    throw new RunError(
      `no verification.finalize list in ${lib.SPECS_DIR}/config.yaml: the gate has nothing to run`,
      'NO_GATE'
    );
  }

  const base = options.base || resolveBase(config, null, tree);
  const scopes = (config.verification && config.verification.finalize_scopes) || {};
  const changed = lib.gitLines(tree, ['diff', '--name-only', `${mergeBase(tree, base)}..HEAD`], { tolerate: true });
  const branch = lib.currentBranch(tree);
  const dir = path.join(lib.cacheDir(tree), branch, `gate-${lib.stamp()}`);

  const out = [];
  const results = [];
  for (const [index, command] of commands.entries()) {
    const scope = scopes[command];
    if (scope && !changed.some((file) => lib.matchesAny(file, scope))) {
      out.push(`SKIP ${command} (no path in scope changed)`);
      results.push({ command, result: 'skip' });
      continue;
    }
    const run = lib.runShell(command, tree, path.join(dir, `${index}.log`));
    if (run.code === 0) {
      out.push(`PASS ${run.seconds}s ${command}`);
      results.push({ command, result: 'pass', seconds: run.seconds });
      continue;
    }
    out.push(`FAIL ${run.seconds}s ${command} -> ${run.log}`);
    out.push(...lib.tail(run.log, 5));
    results.push({ command, result: 'fail', seconds: run.seconds, log: run.log });
    return { exit: 2, payload: { ok: false, tree, branch, results }, out };
  }

  const marker = markerFile(tree);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${new Date().toISOString()}\n${branch}\n${commands.join('\n')}\n`, 'utf8');
  out.push(`green ${path.basename(marker)}`);
  return { exit: 0, payload: { ok: true, tree, branch, results, marker }, out };
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
