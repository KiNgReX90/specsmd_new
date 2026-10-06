'use strict';

/**
 * `run.cjs review` without --item: the cold review of the whole intent, before the gate.
 *
 * It folds the base in first, so the gate's own fold is a no-op unless the base moves again,
 * and prints the reviewer dispatch line. After the reviewer writes review.yaml, the same call
 * validates it, records the tree it read and commits that one file. A fix review sends each
 * finding to the item that owns it; the next intent review reads only what changed since.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const gate = require('./run-gate.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { hostActor } = require('./run-review.cjs');
const owed = require('./run-intent-owed.cjs');

const { RunError } = lib;

const short = (tree, ref) => lib.git(tree, ['rev-parse', '--short', ref]);

function scanRefusal(tree, context, folded) {
  return {
    exit: 3,
    payload: { ok: false, intent: context.intent, owed: 'scan' },
    out: [...folded, `the scan of ${context.intent} is owed: collect it, then run ${owed.reviewCommand(tree, context.options)} again`],
  };
}

function dispatch(tree, context, reasons, from, folded) {
  const { intent, config, rel, options } = context;
  const { agent, model } = hostActor('reviewer', config);
  const range = `${short(tree, from)}..${short(tree, 'HEAD')}`;
  const dir = path.dirname(rel);
  const brief = path.join(dir, 'brief.md');
  const items = owed.intentItems(tree, intent);
  const specs = path.join(dir, 'work-items');
  const scan = owed.scanPath(tree, intent);
  const scanned = fs.existsSync(path.join(tree, scan));
  return {
    exit: 3,
    payload: {
      ok: false, intent, owed: reasons, agent, model, range, brief,
      specs: items.map((id) => path.join(specs, `${id}.md`)), scan: scanned ? scan : null, write: rel,
    },
    out: [
      ...folded,
      ...reasons.map((reason) => `intent review owed for ${intent}: ${reason}`),
      `dispatch ${agent}${model ? ` model ${model}` : ''} intent ${intent}`,
      `  range ${range}`,
      `  brief ${brief}`,
      `  specs ${specs}: ${items.map((id) => `${id}.md`).join(' ') || '(none)'}`,
      ...(scanned ? [`  scan ${scan}`] : []),
      `  write ${rel}`,
      `then ${owed.reviewCommand(tree, options)} records it`,
    ],
  };
}

function verdict(tree, context, review, head) {
  const { intent } = context;
  if (review.verdict === 'clean') {
    return {
      exit: 0,
      payload: { ok: true, intent, verdict: 'clean' },
      out: [head, `then run.cjs gate --tree ${tree} --detach`],
    };
  }
  const out = [head];
  const owners = [...new Set(review.findings.map((finding) => finding.owner))];
  for (const owner of owners) {
    for (const finding of review.findings.filter((entry) => entry.owner === owner)) {
      out.push(`FIX ${owner}: ${finding.criterion} ${finding.file}:${finding.line}: ${finding.evidence}. fix: ${finding.fix}`);
    }
  }
  for (const mutant of review.survivors) out.push(`MUTANT ${mutant.criterion} survived: ${mutant.test}`);
  out.push('send each item its findings as one correction to its warm builder, commit, ' +
    `run.cjs review --item <id> --tree ${tree}, then ${owed.reviewCommand(tree, context.options)} again`);
  return {
    exit: 2,
    payload: { ok: false, intent, verdict: 'fix', owners, findings: review.findings, survivors: review.survivors },
    out,
  };
}

function record(tree, context) {
  const { intent, rel } = context;
  const review = owed.parseFor(tree, rel, intent, false);
  const commit = lib.git(tree, ['rev-parse', 'HEAD']);
  const abs = path.join(tree, rel);
  const text = fs.readFileSync(abs, 'utf8');
  fs.appendFileSync(abs, `${text.endsWith('\n') ? '' : '\n'}tree: ${proofs.scopeHash(tree)}\ncommit: ${commit}\n`);
  lib.git(tree, ['add', '--', rel]);
  lib.git(tree, ['commit', '-q', '-m', `specsmd(${intent}): intent review ${review.verdict}`, '--', rel]);
  return verdict(tree, context, review, `intent review ${review.verdict}, recorded at ${short(tree, commit)}`);
}

function reviewIntent(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const intent = owed.intentFor(tree, options);
  const config = lib.readConfig(tree, options.config);
  const rel = owed.intentReviewPath(tree, intent);
  const context = { intent, config, rel, options };

  const pending = fs.existsSync(path.join(tree, rel)) && lib.gitLines(tree, ['status', '--porcelain', '--', rel]).length > 0;
  if (pending) {
    // The reviewer read this tree as it stands; folding now would bind content it never read.
    const dirty = lib.dirtyPaths(tree).filter((file) => file !== rel);
    if (dirty.length > 0) {
      throw new RunError(
        `refusing to record the intent review over uncommitted work in ${dirty.slice(0, 5).join(', ')}: ` +
          'commit or discard it, then run this command again.',
        'DIRTY'
      );
    }
    if (owed.scanOwed(tree, config, intent)) return scanRefusal(tree, context, []);
    return record(tree, context);
  }

  gate.refuseDirty(tree);
  const base = options.base || resolveBase(config, null, tree);
  const folded = gate.foldBase(tree, base);
  if (owed.scanOwed(tree, config, intent)) return scanRefusal(tree, context, folded);
  const state = owed.intentReviewState(tree, config, intent);
  const current = state.review && state.review.tree === proofs.scopeHash(tree);
  if (current) {
    const head = `intent review ${state.review.verdict} for the current tree (read at ${state.review.commit.slice(0, 7)})`;
    return verdict(tree, context, state.review, `${folded.length ? `${folded[0]}; ` : ''}${head}`);
  }
  const from = state.review && state.review.commit ? state.review.commit : gate.mergeBase(tree, base);
  return dispatch(tree, context, state.owed, from, folded);
}

module.exports = { reviewIntent };
