'use strict';

/**
 * Which browser journeys this landing can break.
 *
 * `run.cjs integrate` used to run the cheap checks only, so twenty e2e cases went red at the
 * first item of an intent and stayed red through the fifth, found hours later at the finalize
 * gate (2026-09-09). The full suite is still the gate's, and too slow to run after every item.
 * This picks the specs the change reaches: the item's own spec targets, the map entries the
 * changed sources hit, and the whole suite whenever a changed source no entry covers leaves
 * the question open. The conservative arm is the point: an unmapped source is not evidence
 * that nothing broke.
 *
 * Zero dependencies, like every script beside it.
 */

const lib = require('./run-lib.cjs');
const { resolveBase } = require('./run-intents.cjs');

const SPEC = /\.spec\.[tj]s$/;

function section(config) {
  const verification = (config && config.verification) || {};
  return verification.integrate_e2e || null;
}

/** The e2e specs an item names itself: its verification targets and any spec it owns. */
function specTargets(manifests) {
  const out = [];
  for (const manifest of manifests || []) {
    const context = (manifest && manifest.context) || {};
    const entries = [...(context.tests || []), ...(context.required || []), ...(context.patterns || [])];
    for (const entry of entries) {
      if (entry && typeof entry.path === 'string' && SPEC.test(entry.path)) out.push(entry.path);
    }
    const editable = (manifest && manifest.ownership && manifest.ownership.editable) || [];
    for (const entry of editable) if (typeof entry === 'string' && SPEC.test(entry)) out.push(entry);
  }
  return out;
}

/** The specs one changed file reaches, or null when no map entry covers it. */
function mapped(file, map) {
  const hits = [];
  for (const [pattern, specs] of Object.entries(map || {})) {
    if (!lib.matchesAny(file, [pattern])) continue;
    for (const spec of Array.isArray(specs) ? specs : [specs]) hits.push(spec);
  }
  return hits.length > 0 ? hits : null;
}

/**
 * One `npx playwright test <specs>` invocation, the full suite, or nothing at all.
 * `changed` contains the intent's own net changes and working tree paths.
 * Paths imported by the base fold are excluded before selection.
 */
function select(options) {
  const config = section(options.config);
  const changed = options.changed || [];
  if (!config) {
    return { specs: [], full: false, command: null, changed, reason: 'no verification.integrate_e2e section' };
  }

  const specs = new Set(specTargets(options.manifests));
  const unmapped = [];
  for (const file of changed) {
    if (SPEC.test(file)) {
      specs.add(file);
      continue;
    }
    // The exemptions come first: a unit test or a catalogue file inside a mapped tree is
    // proved by the runner that reads it, and buys no browser run of its own.
    if (lib.matchesAny(file, config.exempt)) continue;
    const hits = mapped(file, config.map);
    if (hits) {
      for (const spec of hits) specs.add(spec);
      continue;
    }
    if (lib.matchesAny(file, config.full_when)) unmapped.push(file);
  }

  if (unmapped.length > 0) {
    return {
      specs: [],
      full: true,
      command: config.full || null,
      changed,
      reason: `no map entry covers ${unmapped.slice(0, 3).join(', ')}, so the whole suite runs`,
    };
  }

  const picked = [...specs].sort();
  if (picked.length === 0) {
    return { specs: [], full: false, command: null, changed, reason: 'nothing browser-facing changed. Base fold paths are excluded.' };
  }
  return {
    specs: picked,
    full: false,
    command: `${config.command || 'npx playwright test'} ${picked.join(' ')}`,
    changed,
    reason: `${picked.length} spec(s) reached by this landing`,
  };
}

/** Paths changed by non-merge commits that remain different on the final tree. */
function committedPaths(tree, start, end, excluded, firstParent = false) {
  const own = new Set(lib.gitLines(tree, [
    'log', '--no-merges', ...(firstParent ? ['--first-parent'] : []),
    '--format=', '--name-only', '--no-renames', end, '--not', ...excluded, '--',
  ]));
  return lib.gitLines(tree, ['diff', '--name-only', '--no-renames', `${start}..${end}`, '--'])
    .filter((file) => own.has(file));
}

/** The intent's net changes against its base, plus staged, unstaged and new files. */
function changedSince(tree, since) {
  const anchor = typeof since === 'object' && since !== null
    ? since : { ...anchorFor(tree, resolveBase(lib.readConfig(tree), null, tree)), since };
  let committed;
  if (anchor.direct) {
    committed = committedPaths(tree, anchor.since, anchor.head, [anchor.since], true);
  } else {
    const bases = [anchor.base];
    const remote = `origin/${anchor.base}`;
    if (lib.git(tree, ['rev-parse', '--verify', '--quiet', `${remote}^{commit}`], { tolerate: true })) {
      bases.push(remote);
    }
    const fork = lib.git(tree, ['merge-base', anchor.base, 'HEAD']);
    committed = committedPaths(tree, fork, 'HEAD', bases);
  }
  const working = lib.gitLines(tree, ['diff', '--name-only', '--no-renames', 'HEAD', '--']);
  const untracked = lib.gitLines(tree, ['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...committed, ...working, ...untracked])].sort();
}

function sinceRef(tree, ledger, options) {
  const anchor = options.anchor;
  if (anchor && typeof anchor === 'object' && !anchor.direct) return anchor;
  const landing = new Set(options.items || []);
  const proofs = [];
  for (const intent of ledger.intents || []) {
    for (const item of intent.items) {
      if (item.integrated_sha && !landing.has(item.id)) proofs.push(item.integrated_sha);
    }
  }
  for (const sha of proofs.reverse()) {
    if (lib.git(tree, ['cat-file', '-e', `${sha}^{commit}`], { tolerate: true }) !== null) {
      return anchor && typeof anchor === 'object' ? { ...anchor, since: sha } : sha;
    }
  }
  return options.anchor || null;
}

/** Retain the selected base and direct-build head before integrate folds the base. */
function anchorFor(tree, base) {
  const head = lib.git(tree, ['rev-parse', 'HEAD']);
  const selectedBase = base || resolveBase(lib.readConfig(tree), null, tree);
  const direct = lib.currentBranch(tree) === selectedBase;
  const since = direct
    ? lib.git(tree, ['rev-parse', '--verify', '--quiet', 'HEAD~1'], { tolerate: true }) || head
    : lib.git(tree, ['merge-base', 'HEAD', selectedBase]);
  return { base: selectedBase, head, since, direct };
}

module.exports = { anchorFor, changedSince, mapped, section, select, sinceRef, specTargets };
