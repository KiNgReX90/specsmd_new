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
 * Exit codes: 0 ok, 1 usage, 2 failure (details printed), 3 gate needed (green and ship),
 * 4 gate still running (gate --wait: call it again).
 */

const path = require('path');

const lib = require('./run-lib.cjs');
const intents = require('./run-intents.cjs');
const gate = require('./run-gate.cjs');
const { integrate } = require('./run-integrate.cjs');
const { probes } = require('./run-probes.cjs');
const { recordOwner } = require('./run-owner.cjs');
const { ship, teardown } = require('./run-ship.cjs');
const { TransitionError } = require('./state-transition.cjs');

const { RunError } = lib;

const USAGE = `INFERNO orchestrator runner

  node run.cjs select [--config <file>]                  claimable intents, then recovery candidates
  node run.cjs claim <intent-id> [--run <branch>] [--config <file>] take the intent on the base branch and commit it
  node run.cjs unclaim <intent-id> [--config <file>]     give back a claim nothing was built on
  node run.cjs worktree <intent-id> [--path <dir>] [--config <file>] open the intent worktree and bootstrap it
  node run.cjs frontier <intent-id> [--tree <dir>]       validate the contracts, print the ready items
  node run.cjs probes <item-id> [--tree <dir>] [--intent <id>] rerun the item's measurements: 0 they hold, 2 drift
  node run.cjs verify-item <item-id> [--tree <dir>]      the item's own check plus its ownership
  node run.cjs verify-item --items <a,b> [--tree <dir>]  the same for a batch, ownership as the union
  node run.cjs integrate --item <id> [--tree <dir>]      fold the base in, run the checks, complete the item
  node run.cjs integrate --items <a,b> [--tree <dir>]    the same for an explicitly batched chain
  node run.cjs integrate [--tree <dir>] [--config <file>] fold and check without completing anything
  node run.cjs gate [--tree <dir>] [--config <file>]     run the finalize commands without matching proofs
  node run.cjs gate --detach [--tree <dir>]              start the gate as its own process and return
  node run.cjs gate --wait [--tree <dir>] [--minutes <n>] block on the started gate: 0 green, 2 red, 4 still running (default 9 min)
  node run.cjs green [--tree <dir>] [--config <file>]    check the proofs for every finalize command
  node run.cjs ship <intent-id> --tree <dir> [--config <file>] fold, merge, push, verify, tear down
  node run.cjs teardown --tree <dir> [--base <branch>] [--config <file>] remove a worktree and branch the base already holds
  node run.cjs dispatch-log <intent-id> --item <id> --tier <tier> --agent <name>

Options
  --json            machine-readable output
  --tree <dir>      the worktree to operate in (default: the repository of the cwd)
  --config <file>   select, claim, unclaim, worktree, integrate, gate, green, ship and teardown: selected host config relative to the command's root (default .specs-inferno/config.yaml)
  --base <branch>   integrate, gate, ship and teardown: the base branch to fold in (default: the config's base)
  --since <ref>     verify-item: what to compare the working tree against (default HEAD)
  --item <id>       integrate: the item this landing completes once the checks are green
  --items <a,b>     integrate and verify-item: the batched chain, treated as one unit
  --intent <id>     verify-item, integrate and probes: the intent owning the item, when the id is ambiguous
  --minutes <n>     gate --wait: how long one call blocks before exiting 4 (default 9)

Exit codes: 0 ok, 1 usage, 2 failure, 3 a step is owed first (the gate, or an item completed with no integration proof), 4 gate still running.`;

function required(value, usage) {
  if (!value) throw new RunError(`usage: node run.cjs ${usage}`, 'BAD_ARGS', 1);
  return value;
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
  gate: (args, options) => gate.gate(options),
  green: (args, options) => gate.green(options),
  ship: (args, options) => ship(required(args[0], 'ship <intent-id> --tree <dir>'), options),
  teardown: (args, options) => teardown(options),
  'dispatch-log': (args, options) =>
    intents.dispatchLog(required(args[0], 'dispatch-log <intent-id> --item <id> --tier <tier> --agent <name>'), options),
};

/** The steps that work inside an intent worktree, so running one is owning the tree. */
const OWNING = new Set(['frontier', 'probes', 'verify-item', 'integrate', 'gate', 'green', 'ship', 'dispatch-log']);

/** Options that take no value. Everything else starting with `--` takes the next argument. */
const FLAGS = new Set(['--json', '--detach', '--wait']);

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
  // step that learns the path. `select` reads the stamp; see run-owner.cjs.
  if (OWNING.has(command) && options.tree) recordOwner(options.tree, command);
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
