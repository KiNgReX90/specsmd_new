/**
 * The installed flow fits any host, not only the one it grew up in.
 *
 * - Every script a flow text names is one the flow ships, or a host script the text
 *   conditions on the host file it serves.
 * - A step that needs a host file names that condition in the same paragraph or list item.
 * - The Codex orchestrator's dispatch step names the per-round worker cap the session holds.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');

/** A host script the flow does not ship, and the host file a text must condition it on. */
const HOST_SCRIPTS: Record<string, string> = { 'scripts/tester/reserve-cases.mjs': 'integration/TEST-CASES.md' };
const SCRIPT_PATH = /(?:\.\/|[\w.-]+\/)*scripts\/[\w./-]+\.(?:mjs|cjs|js)\b/g;

function texts(): Array<{ file: string; text: string }> {
  return (readdirSync(INFERNO, { recursive: true }) as string[])
    .filter((file) => /\.(?:md|toml|hbs)$/.test(file))
    .map((file) => ({ file, text: readFileSync(path.join(INFERNO, file), 'utf8') }));
}

/** Paragraphs and list items, with a fenced block read as part of the text before it. */
function chunks(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    if (block.trimStart().startsWith('```') && out.length > 0) out[out.length - 1] += `\n${block}`;
    else out.push(...block.split(/\n(?=\s*(?:- |\d+\. ))/));
  }
  return out;
}

const FLOW_FILES = (readdirSync(INFERNO, { recursive: true }) as string[]).map((file) => file.split(path.sep).join('/'));

/** Installed under .specsmd/inferno/, beside the text, or named by its path inside the flow. */
function shipped(file: string, script: string): boolean {
  if (script.startsWith('.specsmd/inferno/')) return existsSync(path.join(INFERNO, script.slice('.specsmd/inferno/'.length)));
  if (existsSync(path.join(INFERNO, path.dirname(file), script))) return true;
  const tail = script.replace(/^\.\//, '');
  return FLOW_FILES.some((shippedFile) => shippedFile.endsWith(`/${tail}`));
}

describe('inferno host fit', () => {
  it('every script a flow text names is shipped by the flow or is a known host script', () => {
    const missing = texts().flatMap(({ file, text }) =>
      [...text.matchAll(SCRIPT_PATH)].map(([script]) => script)
        .filter((script) => !shipped(file, script) && !(script in HOST_SCRIPTS))
        .map((script) => `${file}: ${script}`));
    expect(missing).toEqual([]);
  });

  it('every step naming a host script or its host file is conditioned on the host having that file', () => {
    const unconditioned = Object.entries(HOST_SCRIPTS).flatMap(([script, hostFile]) => texts().flatMap(({ file, text }) =>
      chunks(text)
        .filter((chunk) => (chunk.includes(script) || chunk.includes(hostFile)) && !chunk.includes(`On a host with \`${hostFile}\``))
        .map((chunk) => `${file}: ${script}: ${chunk.trim().split('\n')[0].slice(0, 80)}`)));
    expect(unconditioned).toEqual([]);
  });

  it('the Codex dispatch step names the per-round worker cap', () => {
    const procedure = readFileSync(path.join(INFERNO, 'codex/skills/specsmd-inferno/references/procedure.md'), 'utf8');
    const start = procedure.indexOf('6. Use `spawn_agent`');
    const step = procedure.slice(start, procedure.indexOf('\n7. ', start));
    expect(step).toMatch(/four thread slots/);
    expect(step).toMatch(/at most three workers/);
  });
});
