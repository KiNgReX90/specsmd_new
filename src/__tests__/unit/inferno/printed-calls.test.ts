/**
 * The guard on every runner and ledger writer call the flow prints or teaches.
 *
 * A call printed by a script is built by run-call.cjs, so it carries the caller's tree, intent
 * and host config: run as printed on Codex, it stays on Codex. A call the Codex texts teach
 * carries the Codex config. A pointer to complete-item is never printed, because a hand call
 * has no proof and always refuses; integrate is the call that completes an item.
 *
 * A call is a script or writer command followed by an argument (`--flag`, `<placeholder>` or an
 * interpolation). A bare step name is prose, and usage text documents the calls it lists.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');
const SCRIPTS = path.join(INFERNO, 'agents/orchestrator/skills/orchestrate/scripts');
const CODEX_SKILLS = path.join(INFERNO, 'codex/skills');
const CODEX_CONFIG = '--config .specs-inferno/config.codex.yaml';

const WRITER = ['claim-intent', 'unclaim-intent', 'block-intent', 'unblock-intent', 'complete-item', 'close-intent', 'review-item', 'archive-intent', 'check'];
const STEPS = [
  'select', 'claim', 'unclaim', 'worktree', 'frontier', 'probes', 'verify-item', 'review', 'scan', 'mutate', 'integrate',
  'doubles', 'gate', 'green', 'ship', 'teardown', 'register-process', 'dispatch-log', 'accept-dispatch', ...WRITER,
];
const ARGUMENT = String.raw`(?= (?:--|<|\$\{))`;
const SCRIPT_CALL = new RegExp(String.raw`\b(?:run|state-transition)\.cjs (?:${STEPS.join('|')})\b${ARGUMENT}`, 'g');
const WRITER_CALL = new RegExp(String.raw`(?<![\w./-])(?:${WRITER.filter((cmd) => cmd !== 'check').join('|')})${ARGUMENT}`, 'g');
const COMPLETE_ITEM = /complete-item/g;

/** Blank out a match and keep its line breaks, so every line keeps its number. */
const blank = (match: string) => match.replace(/[^\n]/g, '');

/** The source a script prints from: no comments, no usage text, no comparisons on a command name. */
export function printedSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^\s*\/\/.*$/gm, blank)
    .replace(/const USAGE = (`[\s\S]*?`|'[^']*');/g, blank)
    .replace(/(['"`])usage: [^'"`]*\1/g, blank)
    .replace(/=== '[a-z-]+'/g, blank)
    .replace(/'(?:[a-z-]+) requires --[^']*'/g, blank);
}

/** Every line of the scripts that prints a call outside run-call.cjs, by the rule it breaks. */
export function scriptOffenders(files: Record<string, string>): string[] {
  const offenders: string[] = [];
  for (const [name, source] of Object.entries(files)) {
    if (name === 'run-call.cjs') continue;
    printedSource(source).split('\n').forEach((line, index) => {
      const at = `${name}:${index + 1}`;
      for (const match of line.matchAll(SCRIPT_CALL)) offenders.push(`${at} hand-built ${match[0]}`);
      for (const match of line.matchAll(WRITER_CALL)) offenders.push(`${at} hand-built ${match[0]}`);
      if (COMPLETE_ITEM.test(line)) offenders.push(`${at} points to complete-item`);
      COMPLETE_ITEM.lastIndex = 0;
    });
  }
  return offenders;
}

/** Every call a Codex text teaches without the Codex config: inline code spans and fenced lines. */
export function codexOffenders(files: Record<string, string>): string[] {
  const offenders: string[] = [];
  const call = new RegExp(String.raw`\b(?:run|state-transition)\.cjs (?:${STEPS.join('|')})\b (?:--|<)`);
  for (const [name, text] of Object.entries(files)) {
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, blank);
    let fenced = false;
    body.split('\n').forEach((line, index) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return;
      }
      const spans = fenced ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      for (const span of spans) {
        if (call.test(span) && !span.includes(CODEX_CONFIG)) offenders.push(`${name}:${index + 1} ${span.trim()}`);
      }
      if (/complete-item/.test(line)) offenders.push(`${name}:${index + 1} points to complete-item`);
    });
  }
  return offenders;
}

const scripts = (): Record<string, string> => Object.fromEntries(
  readdirSync(SCRIPTS)
    .filter((file) => file.endsWith('.cjs') && !file.endsWith('.test.cjs') && !file.includes('fixture'))
    .map((file) => [file, readFileSync(path.join(SCRIPTS, file), 'utf8')])
);

const codexTexts = (): Record<string, string> => Object.fromEntries(
  (readdirSync(CODEX_SKILLS, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((file) => file.endsWith('.md'))
    .map((file) => [file, readFileSync(path.join(CODEX_SKILLS, file), 'utf8')])
);

describe('printed calls', () => {
  it('reads the scripts and the Codex texts it guards', () => {
    expect(Object.keys(scripts())).toContain('run-call.cjs');
    expect(Object.keys(scripts()).length).toBeGreaterThan(30);
    expect(Object.keys(codexTexts())).toContain('specsmd-inferno/references/procedure.md');
  });

  it('every call a script prints is built by run-call.cjs, and none points to complete-item', () => {
    expect(scriptOffenders(scripts())).toEqual([]);
  });

  it('every call the Codex texts teach carries the Codex config, and none points to complete-item', () => {
    expect(codexOffenders(codexTexts())).toEqual([]);
  });

  it('flags each kind of hand-built call and pointer', () => {
    expect(scriptOffenders({ 'a.cjs': 'out.push(`then run.cjs integrate --item ${id} --tree ${tree}`);' })).toHaveLength(1);
    expect(scriptOffenders({ 'a.cjs': 'throw new E(`Close it with: close-intent --intent ${id}`);' })).toHaveLength(1);
    expect(scriptOffenders({ 'a.cjs': "throw new E('mark it with complete-item');" })).toHaveLength(1);
    expect(scriptOffenders({ 'a.cjs': "throw new E('complete-item requires --intent and --item');" })).toEqual([]);
    expect(codexOffenders({ 'a.md': 'Run `run.cjs probes <item-id> --tree <path>` first.' })).toHaveLength(1);
    expect(codexOffenders({ 'a.md': 'The `run.cjs frontier` step prints it.' })).toEqual([]);
    expect(codexOffenders({ 'a.md': 'Mark it with `complete-item`.' })).toHaveLength(1);
  });
});
