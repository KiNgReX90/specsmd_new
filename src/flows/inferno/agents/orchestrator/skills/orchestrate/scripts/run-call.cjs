'use strict';

/**
 * A runner call printed for the caller to run next. It carries the caller's tree, intent and
 * host config, so run as printed it reads the config the caller's call read and dispatches
 * that host's agents.
 *
 * A leaf that requires nothing, so the ledger writer prints its calls through it too: run-lib
 * loads the writer, and the writer can load nothing that loads run-lib. Every call a script
 * prints is built here; src/__tests__/unit/inferno/printed-calls.test.ts refuses one built
 * anywhere else.
 */
function runCall(step, tree, options, args = '') {
  const intent = options.intent ? ` --intent ${options.intent}` : '';
  const config = options.config ? ` --config ${options.config}` : '';
  return `run.cjs ${step} --tree ${tree}${args}${intent}${config}`;
}

/**
 * A ledger writer call printed for the caller to run next, with the caller's intent, tree and
 * host config, so a refusal it prints in turn names the caller's own calls.
 */
function writerCall(command, options, args = '') {
  const tree = options.tree ? ` --tree ${options.tree}` : '';
  const config = options.config ? ` --config ${options.config}` : '';
  return `state-transition.cjs ${command} --intent ${options.intent}${args}${tree}${config}`;
}

module.exports = { runCall, writerCall };
