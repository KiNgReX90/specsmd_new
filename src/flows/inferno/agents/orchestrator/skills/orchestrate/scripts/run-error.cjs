'use strict';

/**
 * The one error type these scripts throw: a message, a code the caller branches on, and the
 * status run.cjs exits with. It sits in its own file so the YAML subset and the plumbing can
 * both raise it without requiring each other.
 */
class RunError extends Error {
  constructor(message, code, exit) {
    super(message);
    this.name = 'RunError';
    this.code = code || 'INFERNO_RUN_ERROR';
    this.exit = exit || 2;
  }
}

module.exports = { RunError };
