'use strict';

/**
 * The item frontier of one claimed intent: which work items may be dispatched now.
 *
 * Split out of run-intents.cjs on 2026-09-10, when that file crossed the ceiling. The
 * boundary is the subject. What stayed there is the intent, its claim and its worktree. This
 * is the graph of items inside it: what each manifest promises, which items their dependencies
 * have released, who owns which path, and which tier builds them. `run-frontier.test.cjs` was
 * already named for it.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const scheduler = require('./team-scheduler.cjs');
const ownership = require('./run-ownership.cjs');
const probes = require('./run-probes.cjs');
const { isComplete } = require('./state-transition.cjs');

/** Work an item's kind makes cheap enough for the small tier, whatever its complexity says. */
const CHEAP_KINDS = new Set(['test', 'docs-only', 'docs', 'config-only', 'config']);

/**
 * The hour the proof rule landed. Every ledger written before it carries completed items and
 * no proof at all: the integrate of the day ran the same cheap checks and recorded nothing, so
 * those completions count as proved. An item completed after this hour was marked by something
 * that had the sha available and did not write it.
 */
const PROOF_RULE_LANDED = Date.parse('2026-09-09T18:00:00Z');

/**
 * A work item counts as proved when an integration recorded the sha it ran the checks on, or
 * when it was completed under the flow that predates that rule. A completed item with no proof
 * and a recent timestamp is a run interrupted between the mark and the checks, so its
 * successors stay held until an integration proves the tree it landed on.
 */
function itemIntegrated(item) {
  if (!isComplete(item.status)) return false;
  if (item.integrated_sha) return true;
  const completed = Date.parse(item.completed_at || '');
  return Number.isNaN(completed) || completed < PROOF_RULE_LANDED;
}


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
        title: spec.frontmatter.title || item.title,
        kind: item.kind || String(spec.frontmatter.kind || '').toLowerCase(),
        complexity: item.complexity || String(spec.frontmatter.complexity || '').toLowerCase(),
        depends_on: item.depends_on,
        context: manifest.context || {},
        ownership: manifest.ownership || {},
        reads: manifest.reads,
        probes: manifest.probes,
        description: spec.description,
        diagnosis: manifest.diagnosis,
        file: spec.file,
      };
    });
}

/** The contract check, plus the one team-scheduler cannot make: the paths have to exist. */
function contractErrors(tree, items) {
  const errors = [];
  for (const item of items) {
    errors.push(...scheduler.validateWorkItem(item).errors);
    errors.push(...probes.shapeErrors(item.id, item.probes));
    errors.push(...probes.diagnosisErrors(item));
    for (const entry of item.context.required || []) {
      const target = entry && entry.path;
      if (target && !fs.existsSync(path.join(tree, target))) {
        errors.push(`${item.id}: context.required path does not exist: ${target}`);
      }
    }
    // A declared read names the module holding it, so the same existence check applies.
    for (const entry of Array.isArray(item.reads) ? item.reads : []) {
      const target = entry && entry.path;
      if (target && !fs.existsSync(path.join(tree, target))) {
        errors.push(`${item.id}: reads path does not exist: ${target}`);
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

  const completedIds = new Set(intent.items.filter(itemIntegrated).map((item) => item.id));
  // A completed item is never re-validated and never re-dispatched, whatever its proof: its
  // manifest names the tree of the day it landed, and re-reading it fails on a file the item
  // itself deleted. Without a proof it holds its successors instead, until an integration
  // proves the tree it landed on (2026-09-09).
  const held = intent.items.filter((item) => isComplete(item.status) && !itemIntegrated(item));
  const ready = items.filter((item) => item.depends_on.every((id) => completedIds.has(id)));

  // The evidence a corrective item was planned on, replayed on the tree it is about to be
  // built in. Stale evidence is a cause nobody measured here, and dispatching on it is how a
  // plan asserted a pixel cause it had never seen (2026-09-09).
  const stale = probes.replayErrors(tree, ready);
  if (stale.length > 0) {
    return { exit: 2, payload: { ok: false, errors: stale }, out: stale.map((error) => `INVALID ${error}`) };
  }

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
  const out = held.map(
    (item) =>
      `HELD ${item.id}: completed with no integration proof, run run.cjs integrate --item ${item.id} --tree ${tree} to prove it`
  );
  out.push(...ready.map((item) => `ready ${item.id} ${item.complexity} ${item.kind || 'unset'} ${tierOf(item)}`));
  for (const item of waiting) out.push(`waiting ${item.id} on ${item.depends_on.join(', ')}`);
  for (const pair of serialize) out.push(`serialize ${pair.items.join(' + ')} (shares ${pair.shared.join(', ')})`);
  for (const group2 of batch) out.push(`batch ${group2.join(',')}`);
  // The ownership the planner missed: a file outside the item that names what the item owns.
  const closure = ownership.candidates(tree, ready, items);
  out.push(...ownership.candidateLines(closure));
  if (out.length === 0) out.push('no item left in this intent');
  return {
    exit: held.length > 0 ? 3 : 0,
    payload: {
      ready: ready.map(shape),
      waiting: waiting.map(shape),
      held: held.map((item) => item.id),
      serialize,
      dispatch,
      batch,
      candidates: closure.found,
      skipped: closure.skipped,
    },
    out,
  };
}

module.exports = { frontier, tierOf };
