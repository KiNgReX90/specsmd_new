'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  TransitionError, indentOf, stripInlineComment, unquote, findKeyLine, loadState,
  locateIntents, getIntent, statusOf, isComplete, nowIso, writeState,
} = require('./state-ledger.cjs');
const { readList, removeListValues } = require('./state-lists.cjs');
const { atomicWrite } = require('./state-store.cjs');
const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

const ARCHIVE_HEADER =
  '# Archived INFERNO intents: completed and merged. Historical record, never edited.\n' +
  '# Live state is ../state.yaml. Briefs and work items live in ./intents/<id>/.\n' +
  'intents:\n';

/** Where the archive lives, relative to the live state file. */
function archivePaths(stateFile) {
  const specsDir = path.dirname(path.resolve(stateFile));
  return {
    specsDir,
    archiveFile: path.join(specsDir, 'archive', 'state.yaml'),
    intentsDir: path.join(specsDir, 'intents'),
    archiveIntentsDir: path.join(specsDir, 'archive', 'intents'),
  };
}

/** The ids already in the archive, so a re-run reports "already archived" instead of duplicating. */
function archivedIds(archiveFile) {
  const ids = new Set();
  if (!fs.existsSync(archiveFile)) return ids;
  for (const line of fs.readFileSync(archiveFile, 'utf8').split('\n')) {
    const match = /^ *- id: (.+)$/.exec(line);
    if (match) ids.add(unquote(stripInlineComment(match[1])));
  }
  return ids;
}

/**
 * Intent ids another session is still shipping: a live `inferno-intent/<id>-<stamp>` branch
 * or a worktree named for one. The sweep leaves those alone, because archiving an intent
 * mid-ship rewrites the ledger under the session that owns it. A repo where git cannot
 * answer has no such branches to protect, so an empty set is the honest answer there.
 */
function shippingIds(stateFile) {
  const repo = path.dirname(path.dirname(path.resolve(stateFile)));
  const ids = new Set();
  let out = '';
  try {
    out += execFileSync('git', ['-C', repo, 'branch', '--list', 'inferno-intent/*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    out += execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    return ids;
  }
  for (const match of out.matchAll(/inferno-intent\/(.+?)-\d{8}/g)) ids.add(match[1]);
  return ids;
}

/** Remove archived ids through the same list parser used by claims and scheduling. */
function freeDependencies(lines, intent, ids) {
  return removeListValues(lines, intent, 'depends_on_intents', ids);
}

/**
 * Append one dated line to an intent's rationale, so a reader of a pending intent can see
 * why its prerequisite list shrank.
 *
 * Two shapes carry that rationale in the wild and both have to work: a `comment: |` literal
 * block, and a run of `#` lines under the entry's keys. Handling only the block form meant
 * that in a repo written the other way (every entry carrying one) a dependency vanished
 * from the list with no trace anywhere, which is precisely the drift this note exists to
 * prevent. An entry with neither shape gets no note; freeing the dependency is the
 * load-bearing half, the sentence is the courtesy.
 */
function noteFreedDependencies(lines, intent, freed, date) {
  const subject = freed.length === 1 ? `Prerequisite ${freed[0]}` : `Prerequisites ${freed.join(', ')}`;
  const sentence = `${subject} completed; record moved to archive/state.yaml on ${date}.`;

  const blockIdx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'comment');
  if (blockIdx !== -1) {
    let end = -1;
    let contentIndent = -1;
    for (let i = blockIdx + 1; i < intent.end; i += 1) {
      if (/^\s*$/.test(lines[i])) continue;
      if (indentOf(lines[i]) <= intent.keyIndent) break;
      if (contentIndent === -1) contentIndent = indentOf(lines[i]);
      end = i + 1;
    }
    if (end !== -1) {
      lines.splice(end, 0, `${' '.repeat(contentIndent)}${sentence}`);
      return true;
    }
  }

  // Hash form: land at the end of the comment run that follows the dependency line, which
  // is where these files keep the entry's prose, and never inside `work_items:`.
  const depsIdx = findKeyLine(lines, intent.start, intent.end, intent.keyIndent, 'depends_on_intents');
  if (depsIdx === -1) return false;
  const list = readList(lines, intent, 'depends_on_intents');
  let end = list.members.length && list.form === 'block'
    ? list.members.at(-1).line + 1 : depsIdx + 1;
  const start = end;
  while (end < intent.end && /^\s*#/.test(lines[end])) end += 1;
  if (end === start) return false;
  lines.splice(end, 0, `${' '.repeat(intent.keyIndent)}# ${sentence}`);
  return true;
}

/**
 * Move `.specs-inferno/intents/<id>` under `archive/intents/`, tolerating a half-done move.
 * Both directories present is refused: either could be the newer one, and reporting success
 * would leave the live copy behind for good.
 */
function moveIntentDirectory(paths, id) {
  const from = path.join(paths.intentsDir, id);
  const to = path.join(paths.archiveIntentsDir, id);
  if (fs.existsSync(to)) {
    if (!fs.existsSync(from)) return 'already';
    throw new TransitionError(
      `both ${path.relative(paths.specsDir, from)} and ${path.relative(paths.specsDir, to)} exist. ` +
        'Keep one, remove the other, then run archive-intent again.',
      'ARCHIVE_CONFLICT'
    );
  }
  if (!fs.existsSync(from)) return 'absent';
  fs.mkdirSync(paths.archiveIntentsDir, { recursive: true });
  fs.renameSync(from, to);
  return 'moved';
}

/** Append blocks under the archive's `intents:` key, creating the file when absent. */
function appendToArchive(archiveFile, blocks) {
  fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
  let existing = fs.existsSync(archiveFile)
    ? fs.readFileSync(archiveFile, 'utf8')
    : ARCHIVE_HEADER;
  if (!/^intents:\s*$/m.test(existing)) {
    throw new TransitionError(`archive file has no top-level \`intents:\` key: ${archiveFile}`, 'NO_INTENTS');
  }
  if (!existing.endsWith('\n')) existing += '\n';
  atomicWrite(archiveFile, `${existing}${blocks.join('\n')}\n`);
}

/**
 * Move completed intents out of the live ledger into `archive/state.yaml`, byte for byte.
 *
 * Why this is a command and not prose: the live state is what a session reads to see what
 * is left, and completed intents pile up in it invisibly. `/ship-intent` archived by hand,
 * but the orchestrator's own finalize had no archive step at all, so every intent that
 * closed through auto-close stayed in the live ledger for good. By the time anyone looked
 * (2026-08-25) that was 17 completed intents in one repo and 81 in another. Hand-moving a
 * YAML block is exactly the surgery that drops a comment or flips a status, which is why it
 * belongs to the single writer rather than to a procedure step.
 *
 * `--intent <id>` archives the caller's own intent with no live-branch guard: the caller is
 * standing on that branch, so the guard would refuse the one case that is always safe.
 * `--sweep` adds every other completed intent EXCEPT the ones another session is shipping.
 */
function archiveIntent(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const paths = archivePaths(file);
  const lines = loadState(file);
  const entries = locateIntents(lines);
  const targets = [];
  const skipped = [];

  if (options.intent) {
    const named = entries.find((entry) => entry.id === options.intent);
    if (!named) {
      if (archivedIds(paths.archiveFile).has(options.intent)) {
        // The ledger half is done; an interrupted move may still have left the directory.
        const repaired = moveIntentDirectory(paths, options.intent);
        return {
          changed: repaired === 'moved', archived: [], skipped, freed: [],
          directories: [{ intent: options.intent, result: repaired }],
          archive: path.relative(path.dirname(paths.specsDir), paths.archiveFile),
          note: `${options.intent} already archived`,
        };
      }
      getIntent(lines, options.intent);
    } else if (!isComplete(statusOf(lines, named))) {
      throw new TransitionError(
        `refusing to archive ${options.intent}: status is ${statusOf(lines, named) || 'unset'}, ` +
          `not completed. Close it first with: close-intent --intent ${options.intent}`,
        'NOT_COMPLETE'
      );
    } else {
      targets.push(named);
    }
  }

  if (options.sweep) {
    const shipping = shippingIds(file);
    for (const entry of entries) {
      if (targets.includes(entry)) continue;
      if (!isComplete(statusOf(lines, entry))) continue;
      if (shipping.has(entry.id)) {
        skipped.push(entry.id);
        continue;
      }
      targets.push(entry);
    }
  }

  if (targets.length === 0) {
    return { changed: false, archived: [], skipped, note: 'nothing to archive' };
  }

  // Refuse an unsupported dependency form before anything is written, not halfway through.
  const ids = new Set(targets.map((entry) => entry.id));
  const preview = [...lines];
  for (const entry of entries) {
    if (!ids.has(entry.id)) freeDependencies(preview, getIntent(preview, entry.id), ids);
  }

  const journal = {
    version: 1,
    date: nowIso(options.now).slice(0, 10),
    skipped,
    targets: targets.map((entry) => ({ id: entry.id, block: lines.slice(entry.start, entry.end).join('\n') })),
  };
  atomicWrite(journalPath(file), JSON.stringify(journal));
  return recoverArchive(file, options);
}

function journalPath(file) {
  return `${path.resolve(file)}.archive-journal.json`;
}

/** Intent blocks already in the archive, keyed by id. */
function archivedBlocks(archiveFile) {
  const blocks = new Map();
  if (!fs.existsSync(archiveFile)) return blocks;
  const lines = loadState(archiveFile);
  for (const entry of locateIntents(lines)) blocks.set(entry.id, lines.slice(entry.start, entry.end).join('\n'));
  return blocks;
}

/**
 * Run, or resume, the archive a journal records. An archive touches three places (the
 * archive file, the live ledger, the artifact directories), so a crash between them used to
 * leave an intent in both files or its artifacts in the live tree, and a retry either
 * appended the block twice or reported "already archived" without moving anything. The
 * journal names the blocks before the first write; every phase below is idempotent, so a
 * retry from any interruption finishes the same archive exactly once. Returns null when no
 * archive is in flight.
 */
function recoverArchive(file, options = {}) {
  const journalFile = journalPath(file);
  if (!fs.existsSync(journalFile)) return null;
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  const paths = archivePaths(file);
  const ids = new Set(journal.targets.map((entry) => entry.id));

  // Phase 1: append each block the archive does not hold yet, byte for byte.
  const existing = archivedBlocks(paths.archiveFile);
  for (const target of journal.targets) {
    if (existing.has(target.id) && existing.get(target.id) !== target.block) {
      throw new TransitionError(
        `archive/state.yaml already holds a different ${target.id}. Reconcile the two entries, then delete ${path.basename(journalFile)}.`,
        'ARCHIVE_CONFLICT'
      );
    }
  }
  const missing = journal.targets.filter((entry) => !existing.has(entry.id));
  if (missing.length) appendToArchive(paths.archiveFile, missing.map((entry) => entry.block));
  if (options.failpoint) options.failpoint('archive');

  // Phase 2: free the dependents FIRST, while the blocks are still in place, then cut the
  // blocks back to front so an earlier block's indexes survive a later block's removal.
  const lines = loadState(file);
  const freed = [];
  for (const entry of locateIntents(lines)) {
    if (ids.has(entry.id)) continue;
    const dropped = freeDependencies(lines, getIntent(lines, entry.id), ids);
    if (dropped.length === 0) continue;
    noteFreedDependencies(lines, getIntent(lines, entry.id), dropped, journal.date);
    freed.push({ intent: entry.id, freed: dropped });
  }
  let cut = false;
  for (const entry of locateIntents(lines).reverse()) {
    if (!ids.has(entry.id)) continue;
    lines.splice(entry.start, entry.end - entry.start);
    cut = true;
  }
  if (cut || freed.length) writeState(file, lines);
  if (options.failpoint) options.failpoint('live');

  // Phase 3: the artifact directories.
  const directories = journal.targets.map((entry) => ({
    intent: entry.id,
    result: moveIntentDirectory(paths, entry.id),
  }));
  if (options.failpoint) options.failpoint('artifacts');
  fs.unlinkSync(journalFile);

  return {
    changed: true,
    archived: [...ids],
    skipped: journal.skipped,
    freed,
    directories,
    archive: path.relative(path.dirname(paths.specsDir), paths.archiveFile),
  };
}

module.exports = { archiveIntent, archivePaths, archivedIds, recoverArchive };
