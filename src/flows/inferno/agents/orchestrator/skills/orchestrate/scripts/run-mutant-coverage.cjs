'use strict';

/**
 * Which acceptance criteria still owe a caught mutant before an intent review may say clean.
 *
 * The item's manifest decides by its test paths. Any JavaScript or TypeScript test means every
 * criterion of the item needs a caught mutant that names it, since such a mutant costs one test
 * run. Rust tests alone mean one caught mutant for the item, since each Rust mutant costs a
 * compile. An item with no test path owes none. A mutant counts from the item's own review or
 * from the intent review.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

const JS_TEST = /\.(?:[cm]?[jt]sx?)$/;
const RUST_TEST = /\.rs$/;

/** The criteria under `## Acceptance Criteria`, one per list line, checkbox or not. */
function acceptanceCriteria(content) {
  const section = /\n## Acceptance Criteria[ \t]*\n([\s\S]*?)(?=\n## |$)/.exec(content);
  if (!section) return [];
  return section[1].split('\n')
    .map((line) => /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

/** The caught mutants an item review recorded; none when it has no review file yet. */
function itemMutants(tree, intentId, itemId) {
  for (const base of [['intents'], ['archive', 'intents']]) {
    const file = path.join(tree, lib.SPECS_DIR, ...base, intentId, 'reviews', `${itemId}.yaml`);
    if (!fs.existsSync(file)) continue;
    let doc;
    try {
      doc = lib.parseYaml(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      return [];
    }
    return doc && Array.isArray(doc.mutants) ? doc.mutants.filter((entry) => entry && entry.caught === 'yes') : [];
  }
  return [];
}

/** What each item of the intent needs: its criteria, how its tests prove them, its own mutants. */
function itemProofs(tree, intentId, ids) {
  return ids.map((id) => {
    const spec = lib.readItemSpec(tree, intentId, id);
    const tests = ((spec.manifest.context && spec.manifest.context.tests) || [])
      .map((entry) => (entry && typeof entry === 'object' ? entry.path : entry))
      .filter((entry) => typeof entry === 'string');
    return {
      id,
      criteria: acceptanceCriteria(fs.readFileSync(spec.file, 'utf8')),
      js: tests.some((test) => JS_TEST.test(test)),
      rust: tests.some((test) => RUST_TEST.test(test)),
      mutants: itemMutants(tree, intentId, id),
    };
  });
}

const norm = (text) => String(text).trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether a mutant names criterion `index` (0-based) of `item`. In the item's own review the
 * index alone names it (`2`, `AC2`); in the intent review it carries the item (`<item>:2`).
 * The criterion's text names it in either.
 */
function names(mutant, item, index, own) {
  const said = norm(mutant.criterion);
  if (said === norm(item.criteria[index])) return true;
  const number = own ? /^(?:ac)?\s*#?(\d+)$/.exec(said) : new RegExp(`^${item.id.toLowerCase()}\\s*[:#]\\s*(?:ac)?(\\d+)$`).exec(said);
  return Boolean(number) && Number(number[1]) === index + 1;
}

/** One line per item that still owes a caught mutant, naming the criteria it owes. */
function mutantGaps(items, intentMutants) {
  const lines = [];
  const caught = intentMutants.filter((entry) => entry.caught === 'yes');
  for (const item of items) {
    const named = (index) => item.mutants.some((mutant) => names(mutant, item, index, true)) ||
      caught.some((mutant) => names(mutant, item, index, false));
    if (item.js) {
      const owed = item.criteria.map((text, index) => (named(index) ? null : `${index + 1} "${text}"`)).filter(Boolean);
      if (owed.length > 0) lines.push(`${item.id} owes a caught mutant for criteria ${owed.join(', ')}`);
    } else if (item.rust) {
      const any = item.mutants.length > 0 || item.criteria.some((text, index) => named(index));
      if (!any) lines.push(`${item.id} has no caught mutant`);
    }
  }
  return lines;
}

module.exports = { acceptanceCriteria, itemProofs, mutantGaps };
