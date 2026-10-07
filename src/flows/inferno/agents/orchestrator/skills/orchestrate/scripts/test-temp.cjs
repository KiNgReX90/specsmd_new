'use strict';
// Temp dirs for the flow's own tests and fixtures. Tests and fixtures never call mkdtemp directly.
// Each process makes its dirs under one root of its own, created with mkdtemp so no other process can share it,
// whatever pid it sees. The exit hook removes the root. The helper registers no signal handler, so a process ends
// exactly as it would without it. A process a signal kills leaves its root, and a load removes a root once nothing
// has touched it for a day. No suite lives that long, so a live root is never swept.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = /^inferno-tests-[A-Za-z0-9]{6}$/;
const STALE = 24 * 60 * 60 * 1000;
const roots = new Map();

function remove(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // A dir that cannot be removed must never turn a passing run red.
  }
}

/** Removes every root in `tmp` that nothing has touched for a day, and leaves every other entry alone. */
function sweepStale(tmp) {
  let names = [];
  try {
    names = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const name of names) {
    if (!ROOT.test(name)) continue;
    const root = path.join(tmp, name);
    try {
      const stat = fs.lstatSync(root);
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > STALE) remove(root);
    } catch {
      // Another process removed it first.
    }
  }
}

sweepStale(os.tmpdir());

process.on('exit', () => {
  for (const root of roots.values()) remove(root);
  roots.clear();
});

function tempDir(prefix) {
  const tmp = os.tmpdir();
  if (!roots.has(tmp)) roots.set(tmp, fs.mkdtempSync(path.join(tmp, 'inferno-tests-')));
  return fs.mkdtempSync(path.join(roots.get(tmp), prefix));
}

module.exports = { tempDir };
