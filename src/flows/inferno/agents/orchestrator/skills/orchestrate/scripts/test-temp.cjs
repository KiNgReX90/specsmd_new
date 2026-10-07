'use strict';
// Temp dirs for the flow's own tests and fixtures. Tests and fixtures never call mkdtemp directly.
// Each process makes its dirs under one root of its own, which its exit hook removes. The helper registers no
// signal handler, so a process ends exactly as it would without it. A process a signal kills leaves its root,
// and the next process that loads the helper on that machine removes every root whose process is gone.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = /^inferno-tests-(\d+)$/;
const roots = new Set();

/** True while the process exists. EPERM means it exists under another user. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function remove(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // A dir that cannot be removed must never turn a passing run red.
  }
}

/** Removes every root in `tmp` whose process is gone, and leaves every other entry alone. */
function sweepStale(tmp) {
  let names = [];
  try {
    names = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = Number(ROOT.exec(name)?.[1]);
    if (pid > 0 && !alive(pid)) remove(path.join(tmp, name));
  }
}

sweepStale(os.tmpdir());

process.on('exit', () => {
  for (const root of roots) remove(root);
  roots.clear();
});

function tempDir(prefix) {
  const root = path.join(os.tmpdir(), `inferno-tests-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  roots.add(root);
  return fs.mkdtempSync(path.join(root, prefix));
}

module.exports = { tempDir };
