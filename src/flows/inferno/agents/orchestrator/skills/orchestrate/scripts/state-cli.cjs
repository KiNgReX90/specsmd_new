'use strict';

const { TransitionError } = require('./state-ledger.cjs');
const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `INFERNO state.yaml single-writer

  node state-transition.cjs claim-intent   --intent <id> [--run <run-id>]
  node state-transition.cjs unclaim-intent --intent <id>
  node state-transition.cjs block-intent   --intent <id> --reason "<why>"
  node state-transition.cjs unblock-intent --intent <id>
  node state-transition.cjs complete-item --intent <id> --item <id> --proof <sha>
  node state-transition.cjs close-intent  --intent <id>
  node state-transition.cjs archive-intent [--intent <id>] [--sweep]
  node state-transition.cjs check [--intent <id>]

Options
  --file <path>   state file (default ${DEFAULT_STATE_PATH})
  --run <run-id>  the run taking the intent, recorded as claimed_by (claim-intent)
  --reason <why>  what the intent waits on, recorded as blocked_reason (block-intent)
  --proof <sha>   the integrated tree run.cjs integrate ran the checks on (complete-item)
  --now <iso>     override the timestamp (tests / backfill)
  --json          machine-readable output

claim-intent takes a pending intent for one run: status in_progress plus claimed_at and
claimed_by. It refuses an intent another run holds and one whose prerequisite intents are
not all completed or archived, so two sessions cannot build the same intent. Committing the
claim is the caller's job. unclaim-intent gives back a claim that never integrated.

block-intent parks a pending intent outside the queue: status blocked plus blocked_at and
blocked_reason. It is for an intent that exists and cannot be built yet, waiting on something
the ledger cannot hold as a prerequisite. The reason is required, and select prints it beside
the intent instead of offering it. It refuses an intent a run holds; unclaim that one first.
unblock-intent returns a blocked intent to pending and drops both fields.

archive-intent moves completed intents into archive/state.yaml and archive/intents/, frees
them from the remaining intents' depends_on_intents, and refuses anything not completed.
--sweep adds every other completed intent except one another session is still shipping.
complete-item refuses an item with no integration proof. run.cjs integrate --item <id> runs the
checks on the committed tree and passes the sha they proved, so nothing is marked verified that
nothing verified. close-intent refuses while any work item is still open; complete each item first.
check exits 1 when the ledger drifts from its work items, when a one-item intent does not say on
an INTENT. line why one builder could not do it directly, when .specs-inferno/quick-fixes.md
exists beside it (nothing builds from a parking file).`;

function parseArgs(argv) {
  const options = { file: DEFAULT_STATE_PATH };
  const command = argv[0];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new TransitionError(`unexpected argument: ${arg}`, 'BAD_ARGS');
    // Boolean flags take no value; everything else is `--key value`.
    if (arg === '--json' || arg === '--sweep') {
      options[arg.slice(2)] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TransitionError(`missing value for ${arg}`, 'BAD_ARGS');
    }
    options[arg.slice(2).replace(/-/g, '_')] = value;
    i += 1;
  }
  return { command, options };
}

function main(argv, commands) {
  const {
    claimIntent, unclaimIntent, blockIntent, unblockIntent, completeItem, closeIntent,
    archiveIntent, check,
  } = commands;
  const { command, options } = parseArgs(argv);

  if (!command || ['--help', '-h', 'help'].includes(command)) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command === 'claim-intent') {
    if (!options.intent) throw new TransitionError('claim-intent requires --intent', 'BAD_ARGS');
    const result = claimIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(
        `claimed ${result.intent} at ${result.claimed_at}${result.run ? ` for ${result.run}` : ''}\n`
      );
    } else process.stdout.write(`intent ${result.intent} ${result.note}\n`);
    return 0;
  }

  if (command === 'unclaim-intent') {
    if (!options.intent) throw new TransitionError('unclaim-intent requires --intent', 'BAD_ARGS');
    const result = unclaimIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(`unclaimed ${result.intent} (was ${result.previous}); it is pending again\n`);
    } else process.stdout.write(`intent ${result.intent} ${result.note}\n`);
    return 0;
  }

  if (command === 'block-intent') {
    if (!options.intent) throw new TransitionError('block-intent requires --intent', 'BAD_ARGS');
    // The reason is refused here as well as in the transition, so the usage error names the
    // flag the caller left out rather than the rule behind it.
    if (!options.reason) {
      throw new TransitionError(
        'block-intent requires --reason "<why it cannot be built yet>"',
        'BAD_ARGS'
      );
    }
    const result = blockIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(`blocked ${result.intent} at ${result.blocked_at}: ${result.reason}\n`);
    } else process.stdout.write(`intent ${result.intent} ${result.note}\n`);
    return 0;
  }

  if (command === 'unblock-intent') {
    if (!options.intent) throw new TransitionError('unblock-intent requires --intent', 'BAD_ARGS');
    const result = unblockIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(`unblocked ${result.intent} (was ${result.previous}); it is pending again\n`);
    } else process.stdout.write(`intent ${result.intent} ${result.note}\n`);
    return 0;
  }

  if (command === 'complete-item') {
    if (!options.intent || !options.item) {
      throw new TransitionError('complete-item requires --intent and --item', 'BAD_ARGS');
    }
    const result = completeItem(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(
        `completed ${result.item} (was ${result.previous || 'unset'}) at ${result.completed_at}, ` +
          `integrated ${result.integrated_sha}${result.markdown ? ` + synced ${result.markdown}` : ''}\n`
      );
    } else process.stdout.write(`${result.item} already completed. no change\n`);
    return 0;
  }

  if (command === 'close-intent') {
    if (!options.intent) throw new TransitionError('close-intent requires --intent', 'BAD_ARGS');
    const result = closeIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(
        `closed intent ${result.intent} (was ${result.previous || 'unset'}) at ${result.completed_at}; ` +
          `${result.items} work items completed\n`
      );
    } else process.stdout.write(`intent ${result.intent} already completed. no change\n`);
    return 0;
  }

  if (command === 'archive-intent') {
    if (!options.intent && !options.sweep) {
      throw new TransitionError('archive-intent requires --intent <id> or --sweep', 'BAD_ARGS');
    }
    const result = archiveIntent(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.changed) {
      process.stdout.write(
        `archived ${result.archived.length} intent(s) to ${result.archive}: ${result.archived.join(', ')}\n`
      );
      for (const entry of result.freed) {
        process.stdout.write(`  freed ${entry.intent} from ${entry.freed.join(', ')}\n`);
      }
      for (const entry of result.directories.filter((d) => d.result !== 'moved')) {
        process.stdout.write(`  directory for ${entry.intent}: ${entry.result}\n`);
      }
      if (result.skipped.length > 0) {
        process.stdout.write(`  left alone (still shipping): ${result.skipped.join(', ')}\n`);
      }
    } else process.stdout.write(`${result.note} - no change\n`);
    return 0;
  }

  if (command === 'check') {
    const result = check(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.archived) {
      process.stdout.write(`intent ${result.archived} is archived; nothing left to check in the live ledger\n`);
    } else if (result.drift.length === 0) {
      process.stdout.write(`ledger consistent across ${result.intents} intent(s)\n`);
    } else {
      for (const entry of result.drift) process.stdout.write(`DRIFT ${entry.intent}: ${entry.detail}\n`);
    }
    return result.drift.length === 0 ? 0 : 1;
  }

  throw new TransitionError(`unknown command: ${command}`, 'BAD_ARGS');
}

module.exports = { main };
