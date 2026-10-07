'use strict';

/**
 * The lanes a host configures beside the finalize list: a short smoke run of the built app and
 * the suite on Windows. Each is `verification.<lane>: {command, scope}`. The gate starts a lane
 * whose scope the branch touched and waits for it, so a branch no longer merges red on a check
 * that used to run by hand.
 *
 * It sits apart from run-lib.cjs so the config reader and the job plumbing can both name the
 * lanes without requiring each other.
 */

const { RunError } = require('./run-error.cjs');

const LANES = ['smoke', 'windows'];

function validLane(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.command === 'string' && value.command.trim().length > 0 &&
    Array.isArray(value.scope) && value.scope.length > 0 &&
    value.scope.every((glob) => typeof glob === 'string' && glob.length > 0);
}

function validateLanes(verification, file) {
  for (const lane of LANES) {
    if (verification[lane] === undefined || validLane(verification[lane])) continue;
    throw new RunError(
      `verification.${lane} in ${file} must be a map with command, one shell command, and scope, a list of path globs: ` +
        `"${lane}:" then "command: <shell command>" and "scope: [\\"src/**\\"]" indented under it.`,
      'BAD_CONFIG'
    );
  }
}

/** A --config file inherits each lane the project config sets and it does not. */
function inheritLanes(config, defaults) {
  const from = defaults.verification;
  if (!from || typeof from !== 'object' || Array.isArray(from)) return;
  for (const lane of LANES) {
    if (from[lane] === undefined) continue;
    if (config.verification === undefined) config.verification = {};
    const own = config.verification;
    if (own && typeof own === 'object' && !Array.isArray(own) && own[lane] === undefined) own[lane] = from[lane];
  }
}

/** The configured lanes, in a fixed order, each with its name. */
function configuredLanes(config) {
  const verification = config.verification || {};
  return LANES.filter((lane) => verification[lane] !== undefined)
    .map((lane) => ({ name: lane, command: verification[lane].command, scope: verification[lane].scope }));
}

module.exports = { LANES, configuredLanes, inheritLanes, validateLanes };
