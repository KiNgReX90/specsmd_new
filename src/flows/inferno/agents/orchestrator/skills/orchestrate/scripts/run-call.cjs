'use strict';

/**
 * A runner call printed for the caller to run next. It carries the caller's tree, intent and
 * host config, so run as printed it reads the config the caller's call read and dispatches
 * that host's agents.
 *
 * A leaf that requires nothing, so the ledger writer prints its calls through it too: run-lib
 * loads the writer, and the writer can load nothing that loads run-lib.
 */
function runCall(step, tree, options, args = '') {
  const intent = options.intent ? ` --intent ${options.intent}` : '';
  const config = options.config ? ` --config ${options.config}` : '';
  return `run.cjs ${step} --tree ${tree}${args}${intent}${config}`;
}

module.exports = { runCall };
