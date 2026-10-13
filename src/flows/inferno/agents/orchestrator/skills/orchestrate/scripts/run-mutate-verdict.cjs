'use strict';

const fs = require('fs');

/**
 * Whether a red run caught the mistake. A mistake is caught only when its test ran and noticed it.
 * A build that failed, a file that does not parse and a run something killed never got that far,
 * so each reads no verdict, with the reason.
 *
 * Cargo marks a failed build with `error: could not compile` or a rustc `error[E....]`, and a test
 * binary something killed with `(signal: 9, SIGKILL`. Node marks a file it could not parse with the
 * source frame `<file>:<line>` above a SyntaxError whose first stack frame is node's module loader,
 * under CommonJS, ES modules and type stripping alike. A SyntaxError the code throws while it runs
 * has the code's own frame there, so it stays caught. Vitest marks it with `Transform failed`
 * (esbuild, oxc) or `Parse failure` (rollup, rolldown) above `File: <file>`. Only a parse failure
 * in the mutated file counts. A module that cannot be resolved still reads caught, since no runner
 * ties that failure to the mutated line.
 */

/** Exit codes of a run whose child a signal ended: SIGINT, SIGKILL, SIGTERM. */
const KILLED = new Set([130, 137, 143]);
const KILL_SIGNALS = new Set(['SIGINT', 'SIGKILL', 'SIGTERM']);
const ANSI = /\x1b\[[0-9;]*m/g;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rustBuildFailed(text) {
  return /^error: could not compile `/m.test(text) || /^error\[E\d{4}\]/m.test(text);
}

function nodeParseFailed(lines, abs) {
  const header = new RegExp(`^\\s*(?:file://)?${escape(abs)}:\\d+\\s*$`);
  for (let i = 0; i < lines.length; i += 1) {
    if (!header.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      if (!/^\s*SyntaxError\b/.test(lines[j])) continue;
      const frame = lines.slice(j + 1).find((line) => line.trim().length > 0) || '';
      if (/^\s*at .*\(node:internal\/modules\//.test(frame)) return true;
      break;
    }
  }
  return false;
}

function vitestParseFailed(lines, abs) {
  for (let i = 0; i < lines.length; i += 1) {
    if (!/Transform failed with \d+ error|Error: Parse failure\b/.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 30); j += 1) {
      if (/^\s*FAIL\s/.test(lines[j])) break;
      const file = /^\s*File: (\S+?)(?::\d+(?::\d+)?)?\s*$/.exec(lines[j]);
      // A root-relative `/src/s.ts` names the same file as its absolute path.
      if (file && file[1].startsWith('/') && abs.endsWith(file[1])) return true;
    }
  }
  return false;
}

/**
 * The verdict of one run: `caught` true or false, or null with `why`. `abs` is the mutated file;
 * without it only a build failure and a kill are read.
 */
function verdictOf(run, text, abs) {
  if (run.signal) return { caught: null, why: `ended on ${run.signal}` };
  if (run.code === 0) return { caught: false };
  if (KILLED.has(run.code)) return { caught: null, why: `killed (exit ${run.code})` };
  const clean = String(text || '').replace(ANSI, '');
  const signal = /\(signal: \d+, (SIG[A-Z]+)/.exec(clean);
  if (signal && KILL_SIGNALS.has(signal[1])) return { caught: null, why: `killed (${signal[1]})` };
  if (rustBuildFailed(clean)) return { caught: null, why: 'did not build' };
  const lines = clean.split('\n');
  if (abs && (nodeParseFailed(lines, abs) || vitestParseFailed(lines, abs))) return { caught: null, why: 'did not parse' };
  return { caught: true };
}

/** A run's log, or nothing when it cannot be read. */
function readLog(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    return '';
  }
}

module.exports = { readLog, rustBuildFailed, verdictOf };
