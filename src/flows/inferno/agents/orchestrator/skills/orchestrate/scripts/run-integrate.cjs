'use strict';

/**
 * `run.cjs integrate`: the step that lands one item, or one explicitly batched chain.
 *
 * It folds the base branch in, runs the cheap checks on the committed tree, and only then
 * completes the item in the ledger with the sha it proved. Completion used to come first, so
 * a run that died between the mark and the checks left a ledger claiming verified about a
 * tree nothing had verified, and the next run released the successor on top of it (measured
 * 2026-09-09).
 *
 * A browser step runs here only for a project that configures `verification.integrate_e2e`.
 * DossierForge configures none since 2026-09-11: a selection cost as much as the whole suite
 * and the finalize gate ran the whole suite again anyway, because a proof is keyed on the
 * command string. Its browser suite is in `verification.finalize` and runs once per intent.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const gate = require('./run-gate.cjs');
const proofs = require('./run-proofs.cjs');
const writer = require('./state-transition.cjs');
const impact = require('./run-e2e-impact.cjs');
const { resolveBase } = require('./run-intents.cjs');

const { RunError } = lib;

/** The items this call lands: one `--item`, or the explicit chain in `--items a,b`. */
function itemIds(options) {
  const listed = options.items ? String(options.items).split(',') : [];
  const ids = [...listed, options.item]
    .map((id) => (id ? String(id).trim() : ''))
    .filter((id) => id.length > 0);
  return [...new Set(ids)];
}

function intentOf(ledger, itemId, options) {
  const intent = options.intent
    ? lib.findIntent(ledger, options.intent)
    : ledger.intents.find((entry) => entry.items.some((item) => item.id === itemId));
  if (!intent) throw new RunError(`work item not found in the live ledger: ${itemId}`, 'ITEM_NOT_FOUND');
  return intent;
}

/** Commit the ledger the completion just wrote, so the next step meets a clean tree. */
function commitLedger(tree, intentIds, message) {
  const paths = [
    path.join(lib.SPECS_DIR, 'state.yaml'),
    ...intentIds.map((id) => path.join(lib.SPECS_DIR, 'intents', id)),
  ].filter((rel) => fs.existsSync(path.join(tree, rel)));
  if (paths.length === 0) return [];
  lib.git(tree, ['add', '--', ...paths]);
  if (lib.gitLines(tree, ['diff', '--cached', '--name-only'], { tolerate: true }).length === 0) return [];
  lib.git(tree, ['commit', '-q', '-m', message]);
  return [`ledger commit ${lib.git(tree, ['rev-parse', '--short', 'HEAD'])}`];
}

/**
 * Mark every item of this landing completed, each carrying the sha the checks ran on. The
 * proof is what `state-transition.cjs complete-item` refuses to be marked without.
 */
function completeItems(tree, ids, options) {
  const ledger = lib.readLedger(tree);
  const proof = lib.git(tree, ['rev-parse', '--short', 'HEAD']);
  const intentIds = new Set();
  const out = [];
  for (const id of ids) {
    const intent = intentOf(ledger, id, options);
    intentIds.add(intent.id);
    const result = writer.completeItem({ file: ledger.file, intent: intent.id, item: id, proof });
    out.push(result.changed ? `completed ${id} at ${proof}` : `${id} ${result.note}`);
  }
  const label = ids.length === 1 ? ids[0] : ids.join(', ');
  out.push(...commitLedger(tree, [...intentIds], `specsmd(${[...intentIds].join(', ')}): complete ${label} integrated at ${proof}`));
  return { proof, out };
}

/** The live ledger, or an empty one where a tree carries none. */
function ledgerOf(tree) {
  try {
    return lib.readLedger(tree);
  } catch (error) {
    return { intents: [], file: null };
  }
}

/**
 * The browser journeys this landing can break: the item's own spec targets, the specs the
 * changed sources map to, and the whole suite when a changed source no entry covers leaves the
 * question open. Returns null when the project configures no e2e at integrate.
 */
function e2eSelection(tree, config, ids, options, anchor) {
  if (!impact.section(config)) return null;
  const ledger = ledgerOf(tree);
  const manifests = [];
  for (const id of ids) {
    try {
      const intent = intentOf(ledger, id, options);
      manifests.push(lib.readItemSpec(tree, intent.id, id).manifest);
    } catch (error) {
      continue;
    }
  }
  const since = impact.sinceRef(tree, ledger, { items: ids, anchor });
  const changed = since ? impact.changedSince(tree, since) : [];
  return impact.select({ changed, manifests, config });
}

/** Integrate runs the selected checks and retains each successful command's proof. */
function integrate(options) {
  const tree = gate.treeOf(options);
  gate.refuseDirty(tree);
  const initial = lib.readConfig(tree, options.config);
  const base = options.base || resolveBase(initial, null, tree);
  const ids = itemIds(options);
  // Preserve the branch position before folding the base. Only the browser selection reads it,
  // so a project that configures none reads no git history for it.
  const anchor = impact.section(initial) ? impact.anchorFor(tree, base) : null;
  const folded = gate.foldBase(tree, base);
  const config = lib.readConfig(tree, options.config);
  const commands = (config.verification && config.verification.integrate) || [];
  const started = proofs.scopeHash(tree);
  const definition = JSON.stringify(config.verification);
  const branch = lib.currentBranch(tree);
  const dir = path.join(lib.cacheDir(tree), branch, `integrate-${lib.stamp()}`);
  const results = [];
  // A command with a `finalize_scopes` entry runs here only when the branch touched one of its
  // globs. Without it the cargo tree was left out of this list
  // for cost, and an item merged eight broken Rust cases through a green integrate that the
  // next builder found (2026-09-10).
  const scopes = (config.verification && config.verification.finalize_scopes) || {};
  const changed = gate.changedPaths(tree, gate.mergeBase(tree, base));

  const red = (out) => ({ exit: 2, payload: { ok: false, tree, branch, items: ids, folded: folded.length > 0, results }, out });

  // Every command runs, red or not, and one red result names every failure. Stopping at the
  // first failure cost one orchestrator round trip and one builder correction per failing
  // command: an item that broke check, definitions and cargo paid three integrate runs and
  // three followups to learn what one run could have said.
  for (const [index, command] of commands.entries()) {
    const scope = scopes[command];
    if (scope && !changed.some((file) => lib.matchesAny(file, scope))) {
      results.push({ command, result: 'skip' });
      continue;
    }
    results.push(proofs.runCommand(tree, config, options.config, command, path.join(dir, `${index}.log`)));
  }
  const failures = results.filter((entry) => entry.result === 'fail');
  if (failures.length > 0) {
    return red([
      ...folded,
      ...gate.describe(results),
      `${failures.length} of ${commands.length} integrate command(s) failed; send every failure above to the builder in one correction.`,
    ]);
  }

  const out = [...folded];
  if (commands.length === 0) {
    out.push(`no verification.integrate list in ${lib.SPECS_DIR}/config.yaml: folded ${base} only`);
  } else {
    out.push(...gate.describe(results));
  }

  const selection = e2eSelection(tree, config, ids, options, anchor);
  if (selection && selection.command) {
    const result = proofs.runCommand(tree, config, options.config, selection.command, path.join(dir, 'e2e.log'));
    results.push(result);
    out.push(...gate.describe(results.slice(-1)));
    if (result.result === 'fail') return red(out);
  } else if (selection) {
    out.push(`SKIP e2e (${selection.reason})`);
  }

  if (proofs.scopeHash(tree) !== started ||
      JSON.stringify(lib.readConfig(tree, options.config).verification) !== definition) {
    return red([...out, 'the code changed while integrate ran. Re-run integrate.']);
  }

  if (ids.length === 0) {
    return { exit: 0, payload: { ok: true, tree, branch, items: [], folded: folded.length > 0, results }, out };
  }
  const completion = completeItems(tree, ids, options);
  return {
    exit: 0,
    payload: { ok: true, tree, branch, items: ids, proof: completion.proof, folded: folded.length > 0, results },
    out: [...out, ...completion.out],
  };
}

module.exports = { integrate, itemIds };
