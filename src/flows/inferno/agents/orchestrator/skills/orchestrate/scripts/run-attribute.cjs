'use strict';

/**
 * verify-item's attribution: which dispatch record answers for each reviewed item, and what
 * that record says changed inside and outside the item's ownership. The records themselves
 * live in run-dispatch.cjs.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const dispatch = require('./run-dispatch.cjs');

const { RunError } = lib;

/** The dispatch records verify-item may consult as peers: every accepted one, or `--peers`. */
function peerRecords(tree, peers) {
  if (peers === undefined) return undefined;
  let ids = peers;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch (error) {
      ids = null;
    }
  }
  if (!Array.isArray(ids)) throw new RunError('verify-item --peers requires a JSON array of dispatch ids', 'BAD_ARGS', 1);
  return ids.map((id) => dispatch.loadDispatch(tree, { dispatch_id: id }));
}

/**
 * The dispatch ids the log holds for this item, `null` for a line the runner before signed
 * records wrote: its six fields end before the seventh, the dispatch id, this runner adds.
 */
function loggedDispatches(tree, intent, item) {
  const log = path.join(lib.cacheDir(tree), 'dispatch', `${intent}.log`);
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').map((line) => line.split('\t'))
    .filter((fields) => fields[1] === intent && fields[2] === item)
    .map((fields) => fields[6] || null);
}

function editableOf(tree, intent, ids) {
  const owned = new Set();
  for (const id of ids) {
    const spec = lib.readItemSpec(tree, intent, id);
    for (const entry of (spec.manifest.ownership && spec.manifest.ownership.editable) || []) owned.add(entry);
  }
  return [...owned];
}

/**
 * The record that answers for an item. An item only the runner before signed records dispatched
 * is checked the old way (`null`), so an intent in flight when the runner was updated still
 * lands. A dispatch this runner logged is never checked the old way when its record is missing.
 */
function recordFor(tree, entry, options) {
  try {
    return dispatch.loadDispatch(tree, { intent: entry.intent, item: entry.id, dispatch_id: options.dispatch_id });
  } catch (error) {
    if (!(error instanceof RunError) || !/^no dispatch recorded/.test(error.message) || options.dispatch_id) throw error;
    const logged = loggedDispatches(tree, entry.intent, entry.id);
    const signed = logged.find(Boolean);
    if (signed) {
      throw new RunError(`dispatch ${signed} for ${entry.id} was logged, but ${fs.realpathSync(tree)} has no record of it: pass the ` +
        `--tree its dispatch-log used, or name a baseline with --since if the record left the cache (${lib.cacheDir(tree)})`, 'DISPATCH_PROOF');
    }
    if (logged.length > 0) return null;
    throw error;
  }
}

/**
 * Each reviewed item against the record of the builder that built it, a chain's items against
 * their one shared record, with `options.base` the branch whose fold is excused. Returns `legacy`
 * instead when an item predates signed records. The ledger is the single writer's and never a
 * builder's, so it is never outside.
 */
function attribute(tree, items, options) {
  if (options.dispatch_id && items.length > 1) {
    throw new RunError('--dispatch-id names one item; a batch is checked against each item\'s latest dispatch', 'BAD_ARGS', 1);
  }
  const records = new Map();
  const legacy = [];
  for (const entry of items) {
    const record = recordFor(tree, entry, options);
    if (record) records.set(record.dispatchId, record);
    else legacy.push(entry.id);
  }
  if (legacy.length > 0) return { legacy };

  const peers = peerRecords(tree, options.peers);
  const ledger = (file) => file.startsWith(`${lib.SPECS_DIR}/`);
  const outside = new Set();
  const unreported = new Set();
  const attributed = [];
  for (const record of records.values()) {
    const open = dispatch.openDispatches(tree, record);
    if (open.length > 0) {
      throw new RunError(`dispatch ${open[0].dispatch_id} for ${open[0].items.join(', ')} is still open: run accept-dispatch ` +
        'on every result started since this item\'s baseline, a blocked one with its changed_files as they are, before verify-item', 'DISPATCH_PROOF');
    }
    const ids = dispatch.itemsOf(record);
    const result = dispatch.verifyDispatch(tree, record, editableOf(tree, record.assignment.intent, ids), { peers, base: options.base });
    for (const file of result.outside) if (!ledger(file)) outside.add(file);
    for (const file of result.unreported) if (!ledger(file)) unreported.add(file);
    attributed.push({ items: ids, dispatch_id: result.dispatch_id, since: result.since, changed: result.changed });
  }
  return { since: attributed[0].since, outside: [...outside].sort(), unreported: [...unreported].sort(), attributed };
}

module.exports = { attribute };
