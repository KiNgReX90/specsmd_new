#!/usr/bin/env node
'use strict';

/**
 * INFERNO orchestrator runner: one call per mechanical step of an intent run.
 *
 * Why this exists: every step below used to be prose in the orchestrator's procedure, so the
 * main thread re-read that procedure, re-derived the same git and ledger surgery, and paid
 * for it in context on every round. A step with a stable exit code and at most 30 lines of
 * output costs one tool round and cannot be misremembered.
 *
 * Two constraints, inherited from state-transition.cjs: ZERO dependencies, because these
 * scripts run inside consumer projects with no node_modules; and no ledger write of its own,
 * because state.yaml has one writer and this is not it.
 *
 * Exit codes: 0 ok, 1 usage, 2 failure (details printed), 3 a step is owed first,
 * 4 gate still running (gate --wait: call it again).
 */

const path = require('path');

const lib = require('./run-lib.cjs');
const intents = require('./run-intents.cjs');
const gate = require('./run-gate.cjs');
const { integrate } = require('./run-integrate.cjs');
const { checkDoubles } = require('./check-doubles.cjs');
const { review } = require('./run-review.cjs');
const { reviewIntent } = require('./run-intent-review.cjs');
const { scan } = require('./run-scan.cjs');
const { mutate } = require('./run-mutate.cjs');
const { probes } = require('./run-probes.cjs');
const { recordOwner } = require('./run-owner.cjs');
const { ship, teardown } = require('./run-ship.cjs');
const { TransitionError } = require('./state-transition.cjs');
const processes = require('./run-processes.cjs');

const { RunError } = lib;

const USAGE = `INFERNO orchestrator runner

  node run.cjs select [--config <file>]                  claimable intents, then recovery candidates
  node run.cjs claim <intent-id> [--run <branch>] [--config <file>] take the intent on the base branch and commit it
  node run.cjs unclaim <intent-id> [--config <file>]     give back a claim nothing was built on
  node run.cjs worktree <intent-id> [--path <dir>] [--config <file>] open the intent worktree and bootstrap it
  node run.cjs frontier <intent-id> [--tree <dir>] [--config <file>] validate the contracts, print the ready items and who builds each
  node run.cjs probes <item-id> [--tree <dir>] [--intent <id>] rerun the item's measurements: 0 they hold, 2 drift
  node run.cjs verify-item <item-id> [--tree <dir>]      the item's own check plus its ownership
  node run.cjs verify-item --items <a,b> [--tree <dir>]  the same for a batch, each item against its dispatch
  node run.cjs review --item <id> --tree <dir> [--intent <id>] the item's cold review: 3 dispatch the reviewer, 0 clean, 2 fix
  node run.cjs scan [--tree <dir>] [--intent <id>]      the four scanner briefs before the intent review: 3 spawn the printed lines
  node run.cjs scan --collect [--tree <dir>]            record and commit scan.yaml: 0 recorded, 3 a result missing, 2 a line without its proof
  node run.cjs scan [--collect] --only wiring --plan <intent-id> the plan-time scan: 3 spawn, then 0 no gap, 2 every gap for the planner
  node run.cjs review --tree <dir> [--intent <id>]      the intent's cold review before the gate: 3 dispatch or owed, 0 clean, 2 fix
  node run.cjs mutate --file <f> --line <n> --replace <text> --test <cmd> [--tree <dir>] break one line, run the test, restore: caught yes|no
  node run.cjs integrate --item <id> [--tree <dir>]      fold the base in, run the checks, complete the item
  node run.cjs integrate --items <a,b> [--tree <dir>]    the same for an explicitly batched chain
  node run.cjs integrate [--tree <dir>] [--config <file>] fold and check without completing anything
  node run.cjs doubles [--tree <dir>] [--config <file>] count the test doubles against the merge base: 0 held, 2 rose
  node run.cjs gate [--tree <dir>] [--config <file>] [--force] run the finalize commands without matching proofs
  node run.cjs gate --detach [--tree <dir>]              start the gate as its own process and return
  node run.cjs gate --wait [--tree <dir>] [--minutes <n>] block on the started gate: 0 green, 2 red, 4 still running (default 9 min)
  node run.cjs green [--tree <dir>] [--config <file>]    check the proofs for every finalize command
  node run.cjs ship <intent-id> --tree <dir> [--config <file>] fold, merge, push, verify, tear down
  node run.cjs teardown --tree <dir> [--base <branch>] [--config <file>] remove a worktree and branch the base already holds
  node run.cjs register-process <pid> --tree <dir> --run-id <id> let teardown stop a process the run launched in the tree
  node run.cjs dispatch-log <intent-id> --item <id> | --items <a,b> --tier <tier> --agent <name> [--tree <dir>] record the builder's baseline, print its dispatch id
  node run.cjs accept-dispatch <dispatch-id> --changed-paths <json-array> [--tree <dir>] freeze the result it reported

Options
  --json            machine-readable output
  --tree <dir>      the worktree to operate in (default: the repository of the cwd)
  --config <file>   select, claim, unclaim, worktree, frontier, scan, review, integrate, doubles, gate, green, ship and teardown: selected host config relative to the command's root (default .specs-inferno/config.yaml)
  --base <branch>   integrate, doubles, gate, ship and teardown: the base branch to fold in (default: the config's base)
  --since <ref>     verify-item: compare against this ref instead of the item's accepted dispatch
  --dispatch-id <id> verify-item: the accepted dispatch to check (default the item's latest)
  --peers <json>    verify-item: the dispatch ids that may explain a sibling's change (default every accepted one)
  --item <id>       integrate: the item this landing completes once the checks are green; review: the item reviewed
  --items <a,b>     integrate, verify-item and dispatch-log: the batched chain, treated as one unit
  --intent <id>     verify-item, integrate, review and probes: the intent owning the item, when the id is ambiguous;
                    scan, review, gate and green: the intent a tree on no intent branch builds
  --force           gate: rerun every finalize command, revoking each proof before its run
  --minutes <n>     gate --wait: how long one call blocks before exiting 4 (default 9)
  --only wiring     scan with --plan: the one question the plan-time scan asks, its default
  --plan <id>       scan: ask of the captured plan of this intent instead of its diff

Exit codes: 0 ok, 1 usage, 2 failure, 3 a step is owed first (the gate, an item or intent review, the scan, external evidence, or an item completed with no integration proof or review), 4 gate still running.`;

function required(value, usage) {
  if (!value) throw new RunError(`usage: node run.cjs ${usage}`, 'BAD_ARGS', 1);
  return value;
}

const REGISTER_USAGE = 'register-process <pid> --tree <dir> --run-id <id>';

/** Only a process registered here, by its full identity, can receive teardown's signal. */
function registerProcess(pid, tree, runId) {
  if (!/^[1-9]\d*$/.test(pid)) throw new RunError(`usage: node run.cjs ${REGISTER_USAGE}`, 'BAD_ARGS', 1);
  processes.linkedTree(lib.primaryRoot(tree), tree);
  const record = processes.registerProcess(tree, Number(pid), runId);
  if (!record) {
    return { exit: 0, payload: { registered: null, tree, run_id: runId }, out: ['this system cannot record process identities, so teardown stops nothing'] };
  }
  return { exit: 0, payload: { registered: Number(pid), tree: record.tree, run_id: runId }, out: [`registered ${pid} in ${record.tree}`] };
}

const COMMANDS = {
  select: (args, options) => intents.select(options),
  claim: (args, options) => intents.claim(required(args[0], 'claim <intent-id>'), options),
  unclaim: (args, options) => intents.unclaim(required(args[0], 'unclaim <intent-id>'), options),
  worktree: (args, options) => intents.worktree(required(args[0], 'worktree <intent-id>'), options),
  frontier: (args, options) => intents.frontier(required(args[0], 'frontier <intent-id>'), options),
  probes: (args, options) => probes(required(args[0], 'probes <item-id>'), options),
  'verify-item': (args, options) =>
    gate.verifyItem(required(args[0] || options.items, 'verify-item <item-id> | verify-item --items <a,b>'), options),
  integrate: (args, options) => integrate(options),
  doubles: (args, options) => checkDoubles(options),
  review: (args, options) => (options.item ? review(options) : reviewIntent(options)),
  scan: (args, options) => scan(options),
  mutate: (args, options) => mutate(options),
  gate: (args, options) => gate.gate(options),
  green: (args, options) => gate.green(options),
  ship: (args, options) => ship(required(args[0], 'ship <intent-id> --tree <dir>'), options),
  teardown: (args, options) => teardown(options),
  'register-process': (args, options) =>
    registerProcess(required(args[0], REGISTER_USAGE), required(options.tree, REGISTER_USAGE), required(options.run_id, REGISTER_USAGE)),
  'dispatch-log': (args, options) =>
    intents.dispatchLog(required(args[0], 'dispatch-log <intent-id> --item <id> --tier <tier> --agent <name>'), options),
  'accept-dispatch': (args, options) =>
    intents.acceptDispatch(required(args[0], 'accept-dispatch <dispatch-id> --changed-paths <json-array>'), options),
};

/** The steps that work inside an intent worktree, so running one is owning the tree. */
const OWNING = new Set(['frontier', 'probes', 'verify-item', 'scan', 'review', 'integrate', 'gate', 'green', 'ship', 'dispatch-log', 'accept-dispatch']);

/** Options that take no value. Everything else starting with `--` takes the next argument. */
const FLAGS = new Set(['--json', '--detach', '--wait', '--force', '--collect']);

function parseArgs(argv) {
  const options = { cwd: process.cwd() };
  const args = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }
    if (FLAGS.has(arg)) {
      options[arg.slice(2)] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new RunError(`missing value for ${arg}`, 'BAD_ARGS', 1);
    }
    options[arg.slice(2).replace(/-/g, '_')] = value;
    i += 1;
  }
  if (options.tree) options.tree = path.resolve(options.cwd, options.tree);
  if (options.path) options.path = path.resolve(options.cwd, options.path);
  return { command: argv[0], args, options };
}

function main(argv) {
  const { command, args, options } = parseArgs(argv);

  if (!command || ['--help', '-h', 'help'].includes(command)) {
    process.stdout.write(`${USAGE}\n`);
    return command ? 0 : 1;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`unknown command: ${command}\n${USAGE}\n`);
    return 1;
  }

  // Every step that works a tree stamps the session running it as that tree's owner, before
  // the step so a long gate is owned while it runs, and after `worktree` because that is the
  // step that learns the path. `select` reads the stamp; see run-owner.cjs. A plan-time scan
  // reads the primary checkout, which no run owns.
  if (OWNING.has(command) && options.tree && !options.plan) recordOwner(options.tree, command);
  const result = handler(args, options);
  if (command === 'worktree' && result.payload && result.payload.path) recordOwner(result.payload.path, command);
  if (options.json) process.stdout.write(`${JSON.stringify(result.payload)}\n`);
  else process.stdout.write(`${lib.capLines(result.out).join('\n')}\n`);
  return result.exit;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof RunError) {
      process.stderr.write(`ERROR [${error.code}] ${error.message}\n`);
      process.exit(error.exit);
    }
    // A refusal from the single writer is this run's failure too, not a crash.
    if (error instanceof TransitionError) {
      process.stderr.write(`ERROR [${error.code}] ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}

module.exports = { main };
