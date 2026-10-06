#!/usr/bin/env node
'use strict';

/**
 * Checks the installed flow against flow.lock, with node alone.
 *
 *   node .specsmd/inferno/check-lock.cjs [--root <host root>]
 *
 * Exits 1 and names every installed file whose sha256 differs from the lock and every
 * recorded file that is missing. An entry with a `block` pair covers only the text from
 * the start marker through the end marker, because the rest of that file is the host's.
 * The installer requires this file for the same hashing, so both always agree.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCK_NAME = 'flow.lock';

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** The managed block of a shared file, markers included, or null when it is absent. */
function blockText(text, block) {
  const [startMarker, endMarker] = block;
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return null;
  return text.slice(start, end + endMarker.length);
}

/** The hash a lock entry covers in the given file content, or null when the block is gone. */
function entryHash(content, entry) {
  if (!entry.block) return sha256(content);
  const block = blockText(content.toString('utf8'), entry.block);
  return block === null ? null : sha256(block);
}

/** Compares every recorded file under root with its entry. */
function verify(root, lock) {
  const changed = [];
  const missing = [];
  for (const [rel, entry] of Object.entries(lock.files || {})) {
    const abs = path.join(root, ...rel.split('/'));
    let content;
    try {
      content = fs.readFileSync(abs);
    } catch (error) {
      if (error.code === 'ENOENT') {
        missing.push(rel);
        continue;
      }
      throw error;
    }
    if (entryHash(content, entry) !== entry.sha256) changed.push(rel);
  }
  return { changed, missing };
}

function main(argv) {
  const at = argv.indexOf('--root');
  const root = at >= 0 ? path.resolve(argv[at + 1]) : path.resolve(__dirname, '..', '..');
  const lockPath = path.join(__dirname, LOCK_NAME);
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    console.error(`check-lock: cannot read ${lockPath}: ${error.message}`);
    return 1;
  }
  const { changed, missing } = verify(root, lock);
  if (changed.length === 0 && missing.length === 0) {
    console.log(`check-lock: ${Object.keys(lock.files || {}).length} files match ${LOCK_NAME}`);
    return 0;
  }
  for (const rel of changed) console.error(`changed: ${rel}`);
  for (const rel of missing) console.error(`missing: ${rel}`);
  console.error(`check-lock: ${changed.length + missing.length} installed files differ from ${LOCK_NAME}`);
  return 1;
}

module.exports = { LOCK_NAME, sha256, blockText, entryHash, verify };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
