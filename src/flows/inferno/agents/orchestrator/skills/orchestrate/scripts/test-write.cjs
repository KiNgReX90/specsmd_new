'use strict';
// File writes for the flow's own tests and fixtures. Tests and fixtures never call the plain write directly.
// Git tells a changed file from its size and its timestamps, most builds by the whole second. A rewrite that keeps
// the length inside a second the file had before reads as unchanged once the index is stamped later than the file,
// and a clock set back mid-run produces exactly that. So a rewrite here never lands on a second this process saw
// on the file: when the write's own second is taken, the modification time moves back to the nearest free one.
const fs = require('node:fs');
const path = require('node:path');

const seen = new Map();
const second = (stat) => Math.floor(stat.mtimeMs / 1000);

function writeFile(file, body, options) {
  const key = path.resolve(String(file));
  if (!seen.has(key)) seen.set(key, new Set());
  const taken = seen.get(key);
  try {
    taken.add(second(fs.statSync(key)));
  } catch {
    // A first write has no second to avoid.
  }
  fs.writeFileSync(file, body, options);
  const stat = fs.statSync(key);
  let free = second(stat);
  while (taken.has(free)) free -= 1;
  if (free !== second(stat)) fs.utimesSync(key, stat.atime, free);
  taken.add(free);
}

module.exports = { writeFile };
