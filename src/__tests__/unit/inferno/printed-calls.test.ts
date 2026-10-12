/**
 * The guard on every runner and ledger writer call the flow prints or teaches.
 *
 * A call printed by a script is built by run-call.cjs, so it carries the caller's tree, intent
 * and host config: run as printed on Codex, it stays on Codex. A call the Codex texts teach
 * carries the Codex config. A pointer to complete-item is never printed, because a hand call
 * has no proof and always refuses; integrate is the call that completes an item.
 *
 * The rule on the scripts infers no shape. Outside run-call.cjs and usage text, no printed text
 * holds a script file name or a constant holding one, and none holds a runner or writer
 * subcommand followed by a flag. A bare step name is prose.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import ts from 'typescript';

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');
const SCRIPTS = path.join(INFERNO, 'agents/orchestrator/skills/orchestrate/scripts');
const CODEX_SKILLS = path.join(INFERNO, 'codex/skills');
const CODEX_CONFIG = '--config .specs-inferno/config.codex.yaml';

const WRITER = ['claim-intent', 'unclaim-intent', 'block-intent', 'unblock-intent', 'complete-item', 'close-intent', 'review-item', 'archive-intent', 'check'];
const STEPS = [
  'select', 'claim', 'unclaim', 'worktree', 'frontier', 'probes', 'verify-item', 'review', 'scan', 'mutate', 'integrate',
  'doubles', 'real-app', 'gate', 'green', 'smoke', 'windows', 'ship', 'teardown', 'register-process', 'dispatch-log', 'accept-dispatch', ...WRITER,
];
/** A script file name, or a constant run-call.cjs exports that holds one. */
const SCRIPT = /\b(?:run|state-transition)\.cjs\b|\b(?:RUNNER|RUNNER_PATH|WRITER_SCRIPT)\b/;
/** A subcommand, past any placeholder or interpolation, followed by a flag. */
const SUBCOMMAND_FLAG = new RegExp(String.raw`(?<![\w-])(?:${STEPS.join('|')})(?: (?:<[^>]*>|\$\{[^}]*\}))* --`);

interface Printed { line: number; text: string; usage: boolean }

/**
 * Every piece of text a script can print, as written: each string or template literal and each
 * `+` chain of them, joined, with a name interpolated shown as `${name}` and any other
 * expression as `${}`, its own literals read on their own. The specifier of a
 * require is no text, and usage text (a `*USAGE` constant, a `usage:` line and the argument of
 * `required`) documents the calls it lists.
 */
export function printedTexts(name: string, source: string): Printed[] {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: Printed[] = [];
  const textual = (node: ts.Node): boolean =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) ||
    (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && (textual(node.left) || textual(node.right))) ||
    (ts.isParenthesizedExpression(node) && textual(node.expression));
  const inner: ts.Node[] = [];
  // A name stays readable, so a constant holding a script path shows; a call or other
  // expression shows as `${}`, and its own literals are read on their own.
  const shown = (node: ts.Node): string =>
    (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) ? `\${${node.getText(file)}}` : '${}');
  const join = (node: ts.Node): string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node) && textual(node.expression)) return join(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && textual(node)) {
      return join(node.left) + join(node.right);
    }
    if (ts.isTemplateExpression(node)) {
      return node.head.text + node.templateSpans.map((span) => {
        inner.push(span.expression);
        return `${shown(span.expression)}${span.literal.text}`;
      }).join('');
    }
    inner.push(node);
    return shown(node);
  };
  const visit = (node: ts.Node, usage: boolean): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'require') return;
      if (node.expression.text === 'required') usage = true;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /USAGE$/.test(node.name.text)) usage = true;
    if (textual(node)) {
      const text = join(node);
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      out.push({ line, text, usage: usage || /^usage: /.test(text) });
      for (const expression of inner.splice(0)) visit(expression, usage);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, usage));
  };
  visit(file, false);
  return out;
}

/** Every text outside run-call.cjs that names a script or builds a call, by the rule it breaks. */
export function scriptOffenders(files: Record<string, string>): string[] {
  const offenders: string[] = [];
  for (const [name, source] of Object.entries(files)) {
    if (name === 'run-call.cjs') continue;
    for (const { line, text, usage } of printedTexts(name, source)) {
      if (usage) continue;
      const at = `${name}:${line}`;
      if (SCRIPT.test(text)) offenders.push(`${at} names a script: ${text}`);
      if (SUBCOMMAND_FLAG.test(text)) offenders.push(`${at} builds a call: ${text}`);
      if (/complete-item/.test(text) && !/^complete-item$|complete-item requires/.test(text)) offenders.push(`${at} points to complete-item: ${text}`);
    }
  }
  return offenders;
}

/** Blank out a match and keep its line breaks, so every line keeps its number. */
const blank = (match: string) => match.replace(/[^\n]/g, '');

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
    const flagged = (source: string) => scriptOffenders({ 'a.cjs': source });
    expect(flagged('out.push(`then run.cjs integrate --item ${id} --tree ${tree}`);')).not.toEqual([]);
    expect(flagged('out.push(`leftover ${id}; run teardown --tree ${entry.path}`);')).not.toEqual([]);
    expect(flagged("throw new E('Run run.cjs review ' +\n  `--item ${id} --tree <worktree>`);")).not.toEqual([]);
    expect(flagged("out.push('call gate --wait again');")).not.toEqual([]);
    expect(flagged("const w = `node ${path.join(__dirname, 'run.cjs')} gate --wait --tree ${tree}`;")).not.toEqual([]);
    expect(flagged('const w = `node ${RUNNER_PATH} ${rest}`;')).not.toEqual([]);
    expect(flagged('throw new E(`Close it with: close-intent --intent ${id}`);')).not.toEqual([]);
    expect(flagged("throw new E('mark it with complete-item');")).not.toEqual([]);
    expect(flagged("const w = require('./state-transition.cjs');")).toEqual([]);
    expect(flagged("throw new E('complete-item requires --intent and --item');")).toEqual([]);
    expect(flagged("if (command === 'complete-item') run();")).toEqual([]);
    expect(flagged("out.push('no green marker', 'run gate first');")).toEqual([]);
    expect(flagged("throw new E(`usage: node run.cjs ${usage}`);")).toEqual([]);
    expect(codexOffenders({ 'a.md': 'Run `run.cjs probes <item-id> --tree <path>` first.' })).toHaveLength(1);
    expect(codexOffenders({ 'a.md': 'The `run.cjs frontier` step prints it.' })).toEqual([]);
    expect(codexOffenders({ 'a.md': 'Mark it with `complete-item`.' })).toHaveLength(1);
  });
});
