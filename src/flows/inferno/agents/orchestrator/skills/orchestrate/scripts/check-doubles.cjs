#!/usr/bin/env node
'use strict';

/**
 * The test-double ratchet. A project names what a hand-built double looks like in its tests
 * (`doubles.pattern`) and where its tests live (`doubles.paths`, minus `doubles.exclude`).
 * The count of files carrying that pattern may stay or fall against the merge base with the
 * base branch, never rise. No baseline is stored: the merge base is the baseline.
 *
 * `run.cjs integrate` runs it before the integrate commands whenever `doubles` is set, and
 * `run.cjs doubles` runs it alone. Exit codes: 0 held or skipped, 2 the count rose or the
 * key is malformed.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');
const gate = require('./run-gate.cjs');
const { resolveBase } = require('./run-intents.cjs');

const { RunError } = lib;

const RULE =
  'A test double may only fake the outside world (network, clock, keys, outages). Everything else runs the real code.';

function globs(value) {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.every((entry) => typeof entry === 'string' && entry.length > 0) ? list : null;
}

/** The `doubles` section as a regex and two glob lists, or a refusal naming the bad field. */
function settings(config, label) {
  const section = config.doubles;
  const bad = (what) => new RunError(`doubles in ${label}: ${what}`, 'BAD_CONFIG');
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    throw bad('must be a map with pattern, paths and exclude');
  }
  if (typeof section.pattern !== 'string' || section.pattern.length === 0) {
    throw bad('pattern must be a regex in single quotes');
  }
  let pattern;
  try {
    pattern = new RegExp(section.pattern);
  } catch (error) {
    throw bad(`pattern is not a valid regex: ${error.message}`);
  }
  const paths = globs(section.paths);
  const exclude = globs(section.exclude);
  if (!paths || paths.length === 0) throw bad('paths must list at least one glob');
  if (!exclude) throw bad('exclude must be a list of globs');
  return { pattern, paths, exclude };
}

/** Every blob at `rev` under the globs, read in one `git cat-file --batch` call. */
function blobsAt(tree, rev, paths, exclude) {
  // NUL-separated, so a path with a space or a non-ASCII name arrives unquoted.
  const listed = spawnSync('git', ['ls-tree', '-r', '-z', '--full-tree', rev], {
    cwd: tree,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (listed.status !== 0) throw new RunError(`git ls-tree ${rev} failed in ${tree}`, 'GIT');
  const entries = listed.stdout
    .split('\0')
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [, type, sha] = line.slice(0, tab).split(' ');
      return { type, sha, file: line.slice(tab + 1) };
    })
    .filter((entry) => entry.type === 'blob')
    .filter((entry) => lib.matchesAny(entry.file, paths) && !lib.matchesAny(entry.file, exclude));
  if (entries.length === 0) return [];
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: tree,
    input: `${entries.map((entry) => entry.sha).join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) throw new RunError(`git cat-file failed in ${tree}`, 'GIT');
  const out = result.stdout;
  let offset = 0;
  return entries.map((entry) => {
    const newline = out.indexOf(0x0a, offset);
    const size = Number(out.slice(offset, newline).toString('utf8').split(' ')[2]);
    const body = out.slice(newline + 1, newline + 1 + size).toString('utf8');
    offset = newline + 1 + size + 1;
    return { file: entry.file, body };
  });
}

function matching(tree, rev, rules) {
  return blobsAt(tree, rev, rules.paths, rules.exclude)
    .filter((blob) => rules.pattern.test(blob.body))
    .map((blob) => blob.file);
}

/**
 * Count at HEAD against the merge base. Integrate passes the config it read after the fold;
 * run alone, the check reads it here.
 */
function checkDoubles(options, config) {
  const tree = gate.treeOf(options);
  const read = config || lib.readConfig(tree, options.config);
  const label = options.config || path.join(lib.SPECS_DIR, 'config.yaml');
  if (read.doubles === undefined) {
    return { exit: 0, payload: { ok: true, skipped: true }, out: [`SKIP doubles (no doubles in ${label})`] };
  }
  const rules = settings(read, label);
  const base = options.base || resolveBase(read, null, tree);
  const before = matching(tree, gate.mergeBase(tree, base), rules);
  const now = matching(tree, 'HEAD', rules);
  const payload = { ok: now.length <= before.length, base: before.length, head: now.length };
  if (payload.ok) {
    return { exit: 0, payload, out: [`PASS doubles ${now.length} (base ${before.length})`] };
  }
  const known = new Set(before);
  payload.added = now.filter((file) => !known.has(file));
  return {
    exit: 2,
    payload,
    out: [
      `FAIL doubles ${before.length} -> ${now.length} against ${base}: more files match ${rules.pattern}.`,
      ...payload.added.map((file) => `  new: ${file}`),
      RULE,
    ],
  };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const options = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') options.json = true;
    else if (['--tree', '--config', '--base'].includes(argv[i]) && argv[i + 1]) {
      options[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else {
      process.stderr.write('usage: node check-doubles.cjs [--tree <dir>] [--config <file>] [--base <branch>] [--json]\n');
      process.exit(1);
    }
  }
  if (options.tree) options.tree = path.resolve(options.cwd, options.tree);
  try {
    const result = checkDoubles(options);
    process.stdout.write(options.json ? `${JSON.stringify(result.payload)}\n` : `${lib.capLines(result.out).join('\n')}\n`);
    process.exit(result.exit);
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    process.stderr.write(`ERROR [${error.code}] ${error.message}\n`);
    process.exit(error.exit);
  }
}

module.exports = { RULE, checkDoubles };
