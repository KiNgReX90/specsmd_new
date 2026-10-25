'use strict';

/**
 * The plan-time scan's slices: the work items of a plan, split into disjoint groups each
 * small enough for one scanner to hold every item of it against the live tree.
 *
 * One cold scanner over a whole plan stops after a handful of findings, so each rescan
 * samples another subset of the same gaps. A scanner per slice can be exhaustive within it,
 * and one round finds the set. Split from run-scan.cjs because the split is a rule of its
 * own: the dispatch writes a brief per slice and the collect reads a result per slice.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

/** The words of work-item text one scanner is handed; an item larger than this is a slice alone. */
const SLICE_WORDS = 4500;

const words = (text) => text.split(/\s+/).filter(Boolean).length;

/** The plan's work items in file order, each with its word count and the items it depends on. */
function planItems(tree, intent) {
  const dir = path.join(tree, lib.SPECS_DIR, 'intents', intent, 'work-items');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.md')).sort().map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const front = /^---\n([\s\S]*?)\n---/.exec(text);
    let depends = [];
    try {
      const doc = front ? lib.parseYaml(front[1]) : {};
      if (doc && Array.isArray(doc.depends_on)) depends = doc.depends_on.map(String);
    } catch (error) {
      if (!(error instanceof lib.RunError)) throw error;
    }
    return { id: file.slice(0, -3), words: words(text), depends };
  });
}

/** Each item after the items it depends on, so a chain's neighbours land in one slice. */
function chainOrder(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = new Set();
  const order = [];
  const place = (item, seen) => {
    if (placed.has(item.id) || seen.has(item.id)) return;
    seen.add(item.id);
    for (const id of item.depends) if (byId.has(id)) place(byId.get(id), seen);
    placed.add(item.id);
    order.push(item);
  };
  for (const item of items) place(item, new Set());
  return order;
}

/**
 * The plan's slices in chain order: consecutive items packed until the next would pass
 * `budget` words. Every item lands in exactly one slice.
 */
function planSlices(tree, intent, budget = SLICE_WORDS) {
  const slices = [];
  let current = null;
  for (const item of chainOrder(planItems(tree, intent))) {
    if (!current || current.words + item.words > budget) {
      current = { items: [], words: 0 };
      slices.push(current);
    }
    current.items.push(item.id);
    current.words += item.words;
  }
  return slices;
}

module.exports = { SLICE_WORDS, planItems, planSlices };
