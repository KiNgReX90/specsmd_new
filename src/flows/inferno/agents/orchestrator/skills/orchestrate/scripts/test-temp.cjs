'use strict';
// Temp dirs for the flow's own tests and fixtures. Every dir made here is removed when the process exits,
// so a gate run leaves nothing behind in the system temp dir. Tests and fixtures never call mkdtemp directly.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const made = new Set();

function sweep() {
  for (const dir of made) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // A dir that cannot be removed at exit must never turn a passing run red.
    }
  }
  made.clear();
}

process.on('exit', sweep);

// A fatal signal skips the exit event, so a suite killed by a timeout or Ctrl-C sweeps here.
// The handler steps aside and raises the signal again, so the process still ends the way the signal ends it.
function onSignal(signal) {
  sweep();
  process.kill(process.pid, signal);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, onSignal);

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}

module.exports = { tempDir };
