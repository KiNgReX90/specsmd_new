'use strict';

/**
 * Every call a script prints for its caller to run next, and the only place a script file name
 * appears in one. A call carries the caller's tree, intent and host config, so run as printed
 * it reads the config the caller's call read and dispatches that host's agents.
 *
 * The carried flags are the process's own. The runner and the writer record the flags they
 * were called with through `caller` once, when they parse them, and every call reads the host
 * config from that record, so no site can drop or replace it. A site may name another intent,
 * as the frontier does for its positional one, and another tree.
 *
 * A leaf that loads no other script, so the ledger writer prints its calls through it too:
 * run-lib loads the writer, and the writer can load nothing that loads run-lib. The guard in
 * src/__tests__/unit/inferno/printed-calls.test.ts refuses a script name or a call anywhere else.
 */

const path = require('path');

/** The runner and the ledger writer by file name, and the runner by its own path. */
const RUNNER = 'run.cjs';
const RUNNER_PATH = path.join(__dirname, RUNNER);
const WRITER_SCRIPT = 'state-transition.cjs';

/** The flags this process was called with, recorded once by `caller`. */
const called = { config: null, intent: null, tree: null };

/** Record the flags the runner or the writer was called with, right after it parses them. */
function caller(options) {
  called.config = options.config || null;
  called.intent = options.intent || null;
  called.tree = options.tree || null;
}

const flag = (name, value) => (value ? ` --${name} ${value}` : '');
const carried = (options) => `${flag('intent', options.intent || called.intent)}${flag('config', called.config)}`;

/** A runner call: the step, its own flags, then the caller's tree, intent and host config. */
function runCall(step, tree, options, flags = []) {
  return `${RUNNER} ${[step, ...flags].join(' ')} --tree ${tree}${carried(options)}`;
}

/** The same call by the runner's own path, for a line the caller runs from anywhere. */
function nodeCall(step, tree, options, flags = []) {
  return `node ${RUNNER_PATH}${runCall(step, tree, options, flags).slice(RUNNER.length)}`;
}

/**
 * A ledger writer call: the command, its own flags, then the caller's intent, tree and host
 * config, so a refusal it prints in turn names the caller's own calls.
 */
function writerCall(command, options, flags = []) {
  const intent = flag('intent', options.intent || called.intent);
  return `${WRITER_SCRIPT} ${[command, ...flags].join(' ')}${intent}${flag('tree', options.tree || called.tree)}${flag('config', called.config)}`;
}

module.exports = { RUNNER, RUNNER_PATH, caller, nodeCall, runCall, writerCall };
