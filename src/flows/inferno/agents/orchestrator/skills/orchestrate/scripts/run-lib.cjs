'use strict';

/**
 * Shared plumbing for `run.cjs`: git, the ledger, the config, work-item specs, globs,
 * shell runs and the cache.
 *
 * Two constraints, the same ones state-transition.cjs carries: ZERO dependencies, because
 * these scripts run inside consumer projects that have no node_modules; and the ledger is
 * read through state-transition.cjs's own primitives rather than a second YAML reader that
 * would drift from the writer line by line.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const writer = require('./state-transition.cjs');

class RunError extends Error {
  constructor(message, code, exit) {
    super(message);
    this.name = 'RunError';
    this.code = code || 'INFERNO_RUN_ERROR';
    this.exit = exit || 2;
  }
}

// ---------------------------------------------------------------------------
// A YAML subset: maps, block and inline lists, quoted scalars, block scalars.
// Enough for .specs-inferno/config.yaml and a work item's execution manifest.
// ---------------------------------------------------------------------------

function stripComment(value) {
  let single = false;
  let double = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "'" && !double) single = !single;
    else if (char === '"' && !single) double = !double;
    else if (char === '#' && !single && !double && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i);
    }
  }
  return value;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function scalar(raw) {
  const value = unquote(stripComment(raw).trim());
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((entry) => unquote(entry.trim()))
      .filter((entry) => entry.length > 0);
  }
  return value;
}

function rowsOf(text) {
  return text
    .split('\n')
    .map((line) => ({ indent: /^( *)/.exec(line)[1].length, text: line.trim(), raw: line }))
    .filter((row) => row.text.length > 0 && !row.text.startsWith('#'));
}

function parseBlockScalar(rows, index, indent) {
  const body = [];
  let i = index;
  while (i < rows.length && rows[i].indent > indent) {
    body.push(rows[i].text);
    i += 1;
  }
  return [body.join('\n'), i];
}

function parseNode(rows, index, indent) {
  if (rows[index].text.startsWith('- ')) return parseList(rows, index, indent);
  return parseMap(rows, index, indent);
}

function parseList(rows, index, indent) {
  const out = [];
  let i = index;
  while (i < rows.length && rows[i].indent === indent && rows[i].text.startsWith('- ')) {
    const rest = rows[i].text.slice(2);
    if (/^(?:"[^"]*"|'[^']*'|[^:]+):(?: |$)/.test(rest)) {
      rows[i] = { indent: indent + 2, text: rest, raw: rest };
      const [value, next] = parseMap(rows, i, indent + 2);
      out.push(value);
      i = next;
    } else {
      out.push(scalar(rest));
      i += 1;
    }
  }
  return [out, i];
}

function parseMap(rows, index, indent) {
  const out = {};
  let i = index;
  while (i < rows.length && rows[i].indent === indent && !rows[i].text.startsWith('- ')) {
    const match = /^("[^"]*"|'[^']*'|[^:]+):\s*(.*)$/.exec(rows[i].text);
    if (!match) break;
    const key = unquote(match[1]);
    const rest = match[2];
    i += 1;
    if (rest === '|' || rest === '>' || rest === '|-') {
      const [body, next] = parseBlockScalar(rows, i, indent);
      out[key] = body;
      i = next;
    } else if (rest.trim() === '' && i < rows.length && rows[i].indent > indent) {
      const [value, next] = parseNode(rows, i, rows[i].indent);
      out[key] = value;
      i = next;
    } else {
      out[key] = scalar(rest);
    }
  }
  return [out, i];
}

/** Parse the YAML subset above. Anything richer belongs in a real parser, not here. */
function parseYaml(text) {
  const rows = rowsOf(text);
  if (rows.length === 0) return {};
  return parseNode(rows, 0, rows[0].indent)[0];
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    if (options.tolerate) return null;
    throw new RunError(
      `git ${args.join(' ')} failed in ${cwd}: ${(result.stderr || '').trim().split('\n')[0]}`,
      'GIT'
    );
  }
  return (result.stdout || '').trim();
}

function gitLines(cwd, args, options = {}) {
  const out = git(cwd, args, options);
  return out ? out.split('\n').filter((line) => line.length > 0) : [];
}

function repoRoot(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel'], { tolerate: true });
  if (!root) throw new RunError(`not inside a git repository: ${cwd}`, 'NO_REPO');
  return root;
}

/** The primary checkout, from anywhere: a linked worktree shares its common git dir. */
function primaryRoot(cwd) {
  const common = git(cwd, ['rev-parse', '--git-common-dir'], { tolerate: true });
  if (!common) return repoRoot(cwd);
  return path.dirname(path.resolve(cwd, common));
}

function currentBranch(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

/**
 * Changed paths from `git status --porcelain`, renames resolved to their new name.
 *
 * Read without trimming: the status letters are column-significant, so an unstaged change
 * starts its line with a space, and trimming the output would eat one character of the
 * first path.
 */
function statusPaths(root) {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new RunError(`git status failed in ${root}`, 'GIT');
  return (result.stdout || '').split('\n').filter((line) => line.length > 3).map((line) => {
    const body = line.slice(3);
    const arrow = body.indexOf(' -> ');
    return unquote(arrow === -1 ? body : body.slice(arrow + 4));
  });
}

/** Paths that make the tree dirty, ignoring the prefixes the caller is allowed to carry. */
function dirtyPaths(root, allowed = []) {
  return statusPaths(root).filter(
    (file) => !allowed.some((prefix) => file === prefix || file.startsWith(prefix))
  );
}

// ---------------------------------------------------------------------------
// The ledger and the config
// ---------------------------------------------------------------------------

const SPECS_DIR = '.specs-inferno';

function statePath(root) {
  return path.join(root, SPECS_DIR, 'state.yaml');
}

function readConfig(root) {
  const file = path.join(root, SPECS_DIR, 'config.yaml');
  if (!fs.existsSync(file)) return {};
  return parseYaml(fs.readFileSync(file, 'utf8'));
}

function field(lines, entry, key) {
  const idx = writer.findKeyLine(lines, entry.start, entry.end, entry.keyIndent, key);
  if (idx === -1) return null;
  return writer.unquote(lines[idx].slice(entry.keyIndent + key.length + 1));
}

function inlineList(lines, entry, key) {
  const value = field(lines, entry, key);
  if (!value || !value.startsWith('[')) return [];
  return value
    .slice(1, -1)
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** The live ledger as plain data. Reading only; every write goes through the writer. */
function readLedger(root) {
  const file = statePath(root);
  const lines = writer.loadState(file);
  const intents = writer.locateIntents(lines).map((entry) => ({
    id: entry.id,
    title: field(lines, entry, 'title') || entry.id,
    status: writer.statusOf(lines, entry),
    claimed_by: field(lines, entry, 'claimed_by'),
    claimed_at: field(lines, entry, 'claimed_at'),
    base_branch: field(lines, entry, 'base_branch'),
    depends_on_intents: inlineList(lines, entry, 'depends_on_intents'),
    tester_cases: inlineList(lines, entry, 'tester_cases'),
    comment: lines.slice(entry.start, entry.end).join('\n'),
    items: writer.locateWorkItems(lines, entry).map((item) => ({
      id: item.id,
      title: field(lines, item, 'title') || item.id,
      status: writer.statusOf(lines, item),
      kind: (field(lines, item, 'kind') || '').toLowerCase(),
      complexity: (field(lines, item, 'complexity') || 'medium').toLowerCase(),
      depends_on: inlineList(lines, item, 'depends_on'),
    })),
  }));
  return { file, lines, intents };
}

function findIntent(ledger, id) {
  const intent = ledger.intents.find((entry) => entry.id === id);
  if (!intent) {
    throw new RunError(
      `intent not found in the live ledger: ${id}. Known: ${ledger.intents.map((e) => e.id).join(', ') || '(none)'}`,
      'INTENT_NOT_FOUND'
    );
  }
  return intent;
}

/**
 * A work item's spec: the frontmatter plus the execution manifest.
 *
 * The manifest is plain YAML under the `## Execution Manifest` heading, fenced or not,
 * which is how the planner's template renders it.
 */
function readItemSpec(root, intentId, itemId) {
  const candidates = [
    path.join(root, SPECS_DIR, 'intents', intentId, 'work-items', `${itemId}.md`),
    path.join(root, SPECS_DIR, 'archive', 'intents', intentId, 'work-items', `${itemId}.md`),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    throw new RunError(`work-item spec not found: ${candidates[0]}`, 'SPEC_MISSING');
  }
  const content = fs.readFileSync(file, 'utf8');
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content);
  const section = /\n## Execution Manifest\s*\n([\s\S]*?)(?=\n## |\n?$)/.exec(content);
  const body = section ? section[1].replace(/^\s*```(?:yaml)?\s*$/gm, '') : '';
  return {
    file,
    frontmatter: frontmatter ? parseYaml(frontmatter[1]) : {},
    manifest: parseYaml(body),
  };
}

// ---------------------------------------------------------------------------
// Globs, shell runs, the cache
// ---------------------------------------------------------------------------

/**
 * gitignore-style glob to RegExp: `**` spans path segments, `*` and `?` stay inside one,
 * and a pattern with no slash matches a name at any depth.
 */
function globToRegExp(pattern) {
  const anchored = pattern.includes('/');
  const source = pattern.replace(/\/+$/, '/**');
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '*' && source[i + 1] === '*') {
      if (source[i + 2] === '/') {
        out += '(?:[^/]+/)*';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (char === '*') out += '[^/]*';
    else if (char === '?') out += '[^/]';
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(anchored ? `^${out}$` : `(^|/)${out}$`);
}

function matchesAny(file, patterns) {
  return (patterns || []).some((pattern) => globToRegExp(pattern).test(file));
}

/** Heavy work the machine's build wrapper should queue when one is installed. */
function isHeavy(command) {
  return /\b(build|test|tests|cargo|playwright|vitest)\b/i.test(command);
}

function onPath(binary) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, binary), fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  });
}

/** Run one shell command with its whole output in a log file, never in memory. */
function runShell(command, cwd, logFile, options = {}) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const wrapped = options.wrap !== false && isHeavy(command) && onPath('claude-build');
  const handle = fs.openSync(logFile, 'a');
  const started = Date.now();
  const result = spawnSync(
    wrapped ? 'claude-build' : 'bash',
    wrapped ? ['--', 'bash', '-c', command] : ['-c', command],
    { cwd, stdio: ['ignore', handle, handle] }
  );
  fs.closeSync(handle);
  return {
    command,
    code: result.status === null ? 1 : result.status,
    seconds: Math.round((Date.now() - started) / 1000),
    log: logFile,
    wrapped,
  };
}

function tail(file, count) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .slice(-count);
}

function cacheDir(root) {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'specsmd-inferno', path.basename(primaryRoot(root)));
}

/**
 * The identity of the code in a tree: `git ls-tree HEAD` without the ledger entry, hashed.
 * A commit that only moves `.specs-inferno` keeps the same hash, so the bookkeeping commit
 * after a green gate does not cost a second full gate.
 */
function codeTreeHash(tree) {
  const listing = gitLines(tree, ['ls-tree', 'HEAD'])
    .filter((line) => !line.endsWith(`\t${SPECS_DIR}`))
    .join('\n');
  const result = spawnSync('git', ['hash-object', '--stdin'], {
    cwd: tree,
    input: `${listing}\n`,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new RunError('git hash-object failed', 'GIT');
  return result.stdout.trim();
}

/** Pids whose cwd is inside `dir`, or null where /proc cannot answer. */
function processesIn(dir) {
  let entries;
  try {
    entries = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  } catch (error) {
    return null;
  }
  const found = [];
  for (const entry of entries) {
    let cwd;
    try {
      cwd = fs.readlinkSync(path.join('/proc', entry, 'cwd'));
    } catch (error) {
      continue;
    }
    if (cwd === dir || cwd.startsWith(`${dir}${path.sep}`)) found.push(Number(entry));
  }
  return found;
}

/**
 * Minutes since the worktree last showed work: its tip commit, or the newest
 * edit among its changed and untracked (non-ignored) paths. A process check
 * alone misses every interactive orchestrator, which sits in the primary
 * checkout while its builders edit here; the edits and commits are the signal.
 * Null when nothing can be read.
 */
function idleMinutes(dir, now = Date.now()) {
  let newest = null;
  const tip = git(dir, ['log', '-1', '--format=%ct'], { tolerate: true });
  if (tip && /^\d+$/.test(tip)) newest = Number(tip) * 1000;
  const changed = gitLines(dir, ['status', '--porcelain', '--untracked-files=all'], { tolerate: true });
  for (const line of changed.slice(0, 2000)) {
    const rel = line.slice(3).split(' -> ').pop();
    try {
      const mtime = fs.statSync(path.join(dir, rel)).mtimeMs;
      if (newest === null || mtime > newest) newest = mtime;
    } catch (error) {
      continue;
    }
  }
  if (newest === null) return null;
  return Math.max(0, Math.floor((now - newest) / 60000));
}

/** A UTC branch stamp: 20260903T061242Z. */
function stamp(now) {
  return (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** Keep any human answer inside the 30-line budget the orchestrator reads. */
function capLines(out, max = 30) {
  if (out.length <= max) return out;
  return [...out.slice(0, max - 1), `... ${out.length - (max - 1)} more lines`];
}

module.exports = {
  RunError,
  SPECS_DIR,
  cacheDir,
  capLines,
  codeTreeHash,
  currentBranch,
  dirtyPaths,
  field,
  findIntent,
  git,
  gitLines,
  globToRegExp,
  idleMinutes,
  isHeavy,
  matchesAny,
  onPath,
  parseYaml,
  primaryRoot,
  processesIn,
  readConfig,
  readItemSpec,
  readLedger,
  repoRoot,
  runShell,
  stamp,
  statePath,
  statusPaths,
  tail,
};
