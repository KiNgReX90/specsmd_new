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
const { wiringErrors } = require('./run-wiring.cjs');
const { isComplete } = require('./state-transition.cjs');
const { REINSTALL, completedBeforeReviewRule, reviewRuleSince } = require('./state-review.cjs');
// The tier and the ladder live with the review that moves an item up it, so frontier and
// `run.cjs review --item` print the same actor.
const { actorLabel, hostActor, nextActor, nextLine, tierOf } = require('./run-review.cjs');
const { integrateCall, itemReviewCall } = require('./run-call.cjs');

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
function itemProved(item) {
  if (item.integrated_sha) return true;
  const completed = Date.parse(item.completed_at || '');
  return Number.isNaN(completed) || completed < PROOF_RULE_LANDED;
}

/** The same for the item review: owed by every item completed after this host's cutover. */
function itemReviewed(item, since) {
  return item.review === 'clean' || completedBeforeReviewRule(item.completed_at, since);
}

function itemIntegrated(item, since) {
  return isComplete(item.status) && itemProved(item) && itemReviewed(item, since);
}

/** `intentId` is the intent the frontier was named, so each printed call reaches this intent's item. */
function heldLine(item, tree, since, intentId) {
  const integrate = integrateCall(tree, item.id, intentId);
  if (!itemProved(item)) return `HELD ${item.id}: completed with no integration proof, run ${integrate} to prove it`;
  return `HELD ${item.id}: completed with no clean item review, run ${itemReviewCall(tree, item.id, intentId)}, ` +
    `then ${integrate}${since === null ? `. ${REINSTALL}` : ''}`;
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
        review: item.review,
        review_tier: item.review_tier,
        review_rejections: item.review_rejections,
        review_weight: item.review_weight,
        context: manifest.context || {},
        ownership: manifest.ownership || {},
        reads: manifest.reads,
        provides: manifest.provides,
        consumes: manifest.consumes,
        probes: manifest.probes,
        description: spec.description,
        diagnosis: manifest.diagnosis,
        file: spec.file,
      };
    });
}

/**
 * What the completed items of the intent provide. A provider that already landed still wires
 * its consumers. A completed spec that is gone provides nothing rather than failing the run.
 */
function completedManifests(tree, intent) {
  return intent.items.filter((item) => isComplete(item.status)).map((item) => {
    try {
      return lib.readItemSpec(tree, intent.id, item.id).manifest || {};
    } catch (error) {
      return {};
    }
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
  const config = lib.readConfig(tree, options.config);
  const since = reviewRuleSince(tree);
  const integrated = (item) => itemIntegrated(item, since);

  const errors = contractErrors(tree, items);
  if (errors.length === 0) errors.push(...wiringErrors(tree, intent.id, items, [...items, ...completedManifests(tree, intent)], config));
  if (errors.length > 0) {
    return { exit: 2, payload: { ok: false, errors }, out: errors.map((error) => `INVALID ${error}`) };
  }

  const completedIds = new Set(intent.items.filter(integrated).map((item) => item.id));
  // A completed item is never re-validated and never re-dispatched, whatever its proof: its
  // manifest names the tree of the day it landed, and re-reading it fails on a file the item
  // itself deleted. Without a proof it holds its successors instead, until an integration
  // proves the tree it landed on (2026-09-09).
  const held = intent.items.filter((item) => isComplete(item.status) && !integrated(item));
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
  const shares = (entry, other) => owns(other).some((owned) => lib.overlaps(entry, owned, tree));

  const serialize = [];
  for (let i = 0; i < ready.length; i += 1) {
    for (let j = i + 1; j < ready.length; j += 1) {
      const shared = owns(ready[i]).filter((entry) => shares(entry, ready[j]));
      if (shared.length > 0) serialize.push({ items: [ready[i].id, ready[j].id], shared });
    }
  }

  const dispatch = scheduler
    .selectDispatchableItems(ready, { completedIds, tree })
    .map((item) => item.id);

  // A batch is only a saving when the items could not have run in parallel anyway: same
  // tier, low complexity, and ownership nothing else in the frontier touches.
  const alone = (item) =>
    owns(item).every((entry) => !ready.some((other) => other !== item && shares(entry, other)));
  const batch = [];
  let group = [];
  for (const item of ready) {
    const eligible = item.complexity === 'low' && alone(item);
    if (eligible && (group.length === 0 || nextActor(group[0]).actor === nextActor(item).actor)) group.push(item);
    else {
      if (group.length > 1) batch.push(group.map((entry) => entry.id));
      group = eligible ? [item] : [];
    }
  }
  if (group.length > 1) batch.push(group.map((entry) => entry.id));

  const shape = (item) => {
    const { actor } = nextActor(item);
    return { id: item.id, complexity: item.complexity, kind: item.kind, tier: actor, model: hostActor(actor, config).model };
  };
  const out = held.map((item) => heldLine(item, tree, since, intent.id));
  for (const item of ready) {
    out.push(`ready ${item.id} ${item.complexity} ${item.kind || 'unset'} ${actorLabel(item, config)}`);
    if (item.review === 'fix') out.push(nextLine(item.id, item, config));
  }
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
