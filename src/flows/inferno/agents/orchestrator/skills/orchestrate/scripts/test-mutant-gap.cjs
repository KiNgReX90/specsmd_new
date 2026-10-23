'use strict';
// A --require hook for the flow's own tests. A mutate writes its mutant by opening the file, which
// empties it, and then writing the bytes. Inside a `run.cjs mutate` process this hook holds
// MUTANT_GAP_MS between that open and the write, and appends one line per hold to MUTANT_GAP_LOG,
// so a wait that takes the emptied file for the mutant shows. Every other process runs untouched.
const fs = require('node:fs');

const ms = Number(process.env.MUTANT_GAP_MS);
const log = process.env.MUTANT_GAP_LOG;
const mutating = /(^|[\\/])run\.cjs$/.test(process.argv[1] || '') && process.argv[2] === 'mutate';

if (mutating && ms > 0 && log) {
  const open = fs.openSync;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  fs.openSync = function openSync(file, flags, ...rest) {
    const fd = open.call(fs, file, flags, ...rest);
    if (flags === 'w') {
      fs.appendFileSync(log, `${process.pid} held ${ms} ms after opening ${file}\n`);
      Atomics.wait(pause, 0, 0, ms);
    }
    return fd;
  };
}
