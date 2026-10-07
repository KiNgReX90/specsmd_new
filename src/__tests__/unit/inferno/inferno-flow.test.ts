/**
 * Unit tests for the INFERNO flow packaging invariants.
 *
 * Guards:
 * - Claude wrappers keep the requested model matrix and byte-identical worker
 *   procedures across command, installed-agent, and strong/cheap variants.
 * - The self-contained flow test scripts keep passing from the packaged
 *   source.
 * - The INFERNO tree never references the FIRE artifact namespace.
 * - The flow is registered in FLOWS.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { builtinModules } from 'module';
import os from 'os';
import path from 'path';

const isBuiltin = (id: string) => builtinModules.includes(id);

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return (match ? content.slice(match[0].length) : content).trim();
}

function frontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

describe('inferno flow', () => {
  it('inferno-builder command body is identical to the canonical builder agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-builder.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/builder/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  it.each(['builder-cheap', 'builder-escalate'])('%s wrappers duplicate the strong builder procedure exactly', (role) => {
    const strongCommand = readFileSync(path.join(INFERNO, 'commands/inferno-builder.md'), 'utf8');
    const roleCommand = readFileSync(path.join(INFERNO, `commands/inferno-${role}.md`), 'utf8');
    const strongAgent = readFileSync(path.join(INFERNO, 'agents/builder/agent.md'), 'utf8');
    const roleAgent = readFileSync(path.join(INFERNO, `agents/${role}/agent.md`), 'utf8');
    expect(stripFrontmatter(roleCommand)).toBe(stripFrontmatter(strongCommand));
    expect(stripFrontmatter(roleAgent)).toBe(stripFrontmatter(strongAgent));
    expect(stripFrontmatter(roleCommand)).toBe(stripFrontmatter(roleAgent));
  });

  it('inferno-planner command body is identical to the canonical planner agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-planner.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/planner/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  // Claude Code shows a subagent by its `name:` frontmatter, so every command
  // carries the installed `specsmd-` prefix and every canonical agent the
  // `-agent` suffix the installer expects.
  it.each([
    ['commands/inferno-planner.md', 'specsmd-inferno-planner'],
    ['commands/inferno-builder.md', 'specsmd-inferno-builder'],
    ['commands/inferno-builder-cheap.md', 'specsmd-inferno-builder-cheap'],
    ['commands/inferno-builder-escalate.md', 'specsmd-inferno-builder-escalate'],
    ['commands/inferno-oracle.md', 'specsmd-inferno-oracle'],
    ['commands/inferno-reviewer.md', 'specsmd-inferno-reviewer'],
    ['agents/reviewer/agent.md', 'inferno-reviewer-agent'],
    ['commands/inferno-scanner.md', 'specsmd-inferno-scanner'],
    ['agents/scanner/agent.md', 'inferno-scanner-agent'],
    ['agents/planner/agent.md', 'inferno-planner-agent'],
    ['agents/builder/agent.md', 'inferno-builder-agent'],
    ['agents/builder-cheap/agent.md', 'inferno-builder-cheap-agent'],
    ['agents/builder-escalate/agent.md', 'inferno-builder-escalate-agent'],
    ['agents/oracle/agent.md', 'inferno-oracle-agent'],
  ])('%s is named %s', (rel, name) => {
    const fm = frontmatter(readFileSync(path.join(INFERNO, rel), 'utf8'));
    expect(fm).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, 'm'));
  });

  it('inferno-oracle command body is identical to the canonical oracle agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-oracle.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/oracle/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  it('inferno-reviewer command body is identical to the canonical reviewer agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-reviewer.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/reviewer/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  it('inferno-scanner command body is identical to the canonical scanner agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-scanner.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/scanner/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  // The scanner answers one question and fixes nothing: it writes its result file, and the
  // collect reads exactly the keys it is taught, every question by the id the scripts use.
  it('the scanner carries the tools of a judge and teaches exactly the result schema and the four questions', () => {
    const scanner = readFileSync(path.join(INFERNO, 'commands/inferno-scanner.md'), 'utf8');
    const tools = (frontmatter(scanner).match(/^tools:\s*(.*)$/m)?.[1] ?? '').split(/,\s*/);
    expect(tools.sort()).toEqual(['Bash', 'Glob', 'Grep', 'Read', 'Write']);
    expect(scanner).toMatch(/never fix/);
    const file = require(path.join(INFERNO, 'agents/orchestrator/skills/orchestrate/scripts/run-scan-file.cjs'));
    const blocks = [...scanner.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(blocks).toHaveLength(1);
    expect([...blocks[0].matchAll(/^([a-z_]+):/gm)].map((match) => match[1])).toEqual(file.RESULT_KEYS);
    expect([...blocks[0].matchAll(/^\s+-?\s*([a-z_]+):/gm)].map((match) => match[1])).toEqual(file.LINE_KEYS);
    for (const [id, question] of Object.entries(file.QUESTIONS)) expect(scanner).toContain(`- \`${id}\`: ${question}`);
  });

  // The planner launcher scans every captured plan for wiring gaps before it hands the plan
  // over, on each host by a call that runs from the project root.
  it.each([
    ['claude/commands/inferno-planner.md', ''],
    ['codex/skills/specsmd-inferno-planner/SKILL.md', ' --config .specs-inferno/config.codex.yaml'],
  ])('%s runs the plan-time scan', (rel, config) => {
    const text = readFileSync(path.join(INFERNO, rel), 'utf8');
    expect(text).toContain(
      `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs scan --only wiring --plan <intent-id>${config}`
    );
  });

  // A Codex recovery lands work the branch already holds through integrate on the Codex config.
  // A hand complete-item has no proof and refuses, and a call without --config reads the Claude
  // host's config, so its next printed call dispatches the Claude reviewer.
  it('the Codex recovery step lands landed work through integrate on the Codex config', () => {
    const text = readFileSync(path.join(INFERNO, 'codex/skills/specsmd-inferno/references/procedure.md'), 'utf8');
    const step = text.slice(text.indexOf('4. For recovery'), text.indexOf('5. For a fresh'));
    expect(step).toContain('`run.cjs integrate --item <item-id> --tree <path> --config .specs-inferno/config.codex.yaml`');
    expect(step).not.toContain('complete-item');
  });

  // The reviewer judges and records nothing itself: it may write its review file, and run.cjs
  // commits it. The two file shapes it is taught are exactly the keys the scripts accept.
  it('the reviewer carries the tools of a judge and teaches exactly the review schemas', () => {
    const reviewer = readFileSync(path.join(INFERNO, 'commands/inferno-reviewer.md'), 'utf8');
    const tools = (frontmatter(reviewer).match(/^tools:\s*(.*)$/m)?.[1] ?? '').split(/,\s*/);
    expect(tools.sort()).toEqual(['Bash', 'Glob', 'Grep', 'Read', 'Write']);
    expect(reviewer).toMatch(/never commit/);
    const scripts = path.join(INFERNO, 'agents/orchestrator/skills/orchestrate/scripts');
    const item = require(path.join(scripts, 'run-review-file.cjs'));
    const intent = require(path.join(scripts, 'run-intent-review-file.cjs'));
    const blocks = [...reviewer.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(blocks).toHaveLength(2);
    const top = (block: string) => [...block.matchAll(/^([a-z_]+):/gm)].map((match) => match[1]);
    const nested = (block: string, key: string) => {
      const section = block.split(new RegExp(`^${key}:`, 'm'))[1].split(/^[a-z_]+:/m)[0];
      return [...section.matchAll(/^\s+-?\s*([a-z_]+):/gm)].map((match) => match[1]);
    };
    expect(top(blocks[0])).toEqual(item.ITEM_KEYS);
    expect(nested(blocks[0], 'findings')).toEqual([...item.FINDING_KEYS, 'repeat']);
    expect(nested(blocks[0], 'mutants')).toEqual(item.MUTANT_KEYS);
    expect(top(blocks[1])).toEqual(intent.INTENT_KEYS);
    expect(nested(blocks[1], 'criteria')).toEqual([...intent.CRITERION_KEYS, 'evidence']);
    expect(nested(blocks[1], 'findings')).toEqual([...item.FINDING_KEYS, 'owner']);
    expect(nested(blocks[1], 'scanner')).toEqual(intent.SCANNER_KEYS);
    expect(nested(blocks[1], 'mutants')).toEqual(item.MUTANT_KEYS);
  });

  // The oracle exists to end postponement: it returns one decision, never a menu,
  // and only one of the four verdicts.
  it('the oracle result contract names exactly the four verdicts', () => {
    const agent = readFileSync(path.join(INFERNO, 'agents/oracle/agent.md'), 'utf8');
    expect(agent).toMatch(/verdict: decide \| defect \| user \| blocked/);
  });

  // It never edits: a fix-now block goes to the builder tier, after the oracle's
  // decision when the block says hard (2026-09-10). No editing tool is on the
  // list, and the constraint fences the rest.
  it('the oracle command carries no editing tool and the constraint that fences it', () => {
    const oracle = readFileSync(path.join(INFERNO, 'commands/inferno-oracle.md'), 'utf8');
    const tools = frontmatter(oracle).match(/^tools:.*$/m)?.[0] ?? '';
    expect(tools).toMatch(/\bRead\b/);
    expect(tools).not.toMatch(/\b(Write|Edit|MultiEdit)\b/);
    expect(oracle).toMatch(/NEVER edit a tracked file, NEVER commit/);
    expect(oracle).toMatch(/## Who builds/);
    expect(oracle).not.toMatch(/## When you build/);
  });

  it.each([
    ['commands/inferno-planner.md', 'claude-opus-5-5', 'xhigh'],
    ['commands/inferno-builder.md', 'claude-opus-5-5', 'high'],
    ['commands/inferno-builder-cheap.md', 'claude-sonnet-5-5', 'high'],
    ['commands/inferno-builder-escalate.md', 'claude-opus-5-5', 'xhigh'],
    ['commands/inferno-config.md', 'claude-sonnet-5-5', 'high'],
    ['commands/inferno-oracle.md', 'claude-opus-5-5', 'xhigh'],
    ['agents/planner/agent.md', 'claude-opus-5-5', 'xhigh'],
    ['agents/builder/agent.md', 'claude-opus-5-5', 'high'],
    ['agents/builder-cheap/agent.md', 'claude-sonnet-5-5', 'high'],
    ['agents/builder-escalate/agent.md', 'claude-opus-5-5', 'xhigh'],
    ['agents/oracle/agent.md', 'claude-opus-5-5', 'xhigh'],
    ['commands/inferno-reviewer.md', 'claude-opus-5-5', 'xhigh'],
    ['agents/reviewer/agent.md', 'claude-opus-5-5', 'xhigh'],
    ['commands/inferno-scanner.md', 'claude-sonnet-5-5', 'high'],
    ['agents/scanner/agent.md', 'claude-sonnet-5-5', 'high'],
  ])('%s pins model %s at effort %s', (rel, model, level) => {
    const fm = frontmatter(readFileSync(path.join(INFERNO, rel), 'utf8'));
    expect(fm).toMatch(new RegExp(`^model:\\s*${model}\\s*$`, 'm'));
    expect(fm).toMatch(new RegExp(`^effort:\\s*${level}\\s*$`, 'm'));
  });

  // The orchestrator is the main thread: it inherits the session's model and
  // effort, so pinning either one here would override the user's own session.
  it.each(['commands/inferno.md', 'agents/orchestrator/agent.md', 'claude/commands/inferno-planner.md'])(
    '%s pins neither model nor effort',
    (rel) => {
      const fm = frontmatter(readFileSync(path.join(INFERNO, rel), 'utf8'));
      expect(fm).not.toMatch(/^model:/m);
      expect(fm).not.toMatch(/^effort:/m);
    }
  );

  // A judgment call a builder or the orchestrator would otherwise park as a
  // "residual" or hand to the user as "your call" goes to the oracle instead.
  it('the orchestrator and the builder route judgment calls to the oracle', () => {
    const orchestrator = readFileSync(path.join(INFERNO, 'agents/orchestrator/agent.md'), 'utf8');
    expect(orchestrator).toMatch(/<oracle critical="true">/);
    expect(orchestrator).toMatch(/specsmd-inferno-oracle/);
    expect(orchestrator).toMatch(/`notes` starting `oracle:`/);

    const builder = readFileSync(path.join(INFERNO, 'agents/builder/agent.md'), 'utf8');
    expect(builder).toMatch(/## The oracle/);
    expect(builder).toMatch(/`notes` starting `oracle:`/);
    expect(builder).not.toMatch(/yours to decide/);
  });

  // A headless run ends with its turn, and a background tool call ends with it, gate and
  // all (2026-09-03). The gate is its own process and the orchestrator blocks on it.
  it('the orchestrator waits for the gate through gate --detach and gate --wait', () => {
    const orchestrator = readFileSync(path.join(INFERNO, 'agents/orchestrator/agent.md'), 'utf8');
    expect(orchestrator).toMatch(/gate --tree \{path\} --detach/);
    expect(orchestrator).toMatch(/gate --tree \{path\} --wait/);
    expect(orchestrator).toMatch(/first folds the base branch in, so the tree it proves is the tree ship merges/);
    expect(orchestrator).not.toMatch(/background task that notifies/);
    expect(orchestrator).toMatch(/In a headless run \(`INFERNO_AUTORUN=1`\) launch nothing/);
  });

  it('Claude config defaults use only the requested exact model IDs', () => {
    const config = readFileSync(
      path.join(INFERNO, 'agents/orchestrator/config.example.yaml'),
      'utf8'
    );
    expect(config).toMatch(/^\s*strong:\s*claude-opus-5-5\b/m);
    expect(config).toMatch(/^\s*cheap:\s*claude-sonnet-5-5\b/m);
    // No run dispatches a tester, so the example offers no tester tier.
    expect(config).not.toMatch(/^\s*tester(?:_high)?:/m);
    // The planner writes its own work items, so the scribe tier is gone.
    expect(config).not.toMatch(/^\s*writer:/m);
    expect(config).not.toMatch(/gpt[- ]?5(?:\.| )?5|gpt-5\.6/i);
  });

  // Which test trees a project has is host knowledge, so the planner reads them from config.
  it.each([
    'agents/planner/agent.md',
    'commands/inferno-planner.md',
    'codex/skills/specsmd-inferno-planner/references/procedure.md',
  ])('%s takes its blast-radius test trees from planner.test_trees', (rel) => {
    const text = readFileSync(path.join(INFERNO, rel), 'utf8');
    expect(text).toMatch(/`planner\.test_trees`/);
    expect(text).not.toMatch(/#\[cfg\(test\)\]/);
  });

  // The launcher acts on the planner's handoff by its labels, so a label renamed on either
  // side is a launcher that no longer finds what it builds.
  it('every label the planner launcher acts on is one the planner agent writes', () => {
    const launcher = readFileSync(path.join(INFERNO, 'claude/commands/inferno-planner.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/planner/agent.md'), 'utf8');
    const labels = ['Triage:', 'Intent PLANNED', 'reserve: TC-<n> <title> for <intent-id>/<item-id>', 'direct:', 'oracle:'];
    for (const label of labels) {
      expect(launcher, label).toContain(label);
      expect(agent, label).toContain(label);
    }
    for (const field of ['change', 'files', 'test', 'proof', 'grade', 'hard', 'measured']) {
      expect(launcher, field).toContain(`\`${field}\``);
      expect(agent, field).toMatch(new RegExp(`^  ${field}: `, 'm'));
    }
  });

  it('the intents command names every line prefix the selector prints', () => {
    const command = readFileSync(path.join(INFERNO, 'claude/commands/inferno-intents.md'), 'utf8');
    const selector = readFileSync(
      path.join(INFERNO, 'agents/orchestrator/skills/orchestrate/scripts/run-intents.cjs'),
      'utf8'
    );
    for (const prefix of ['claimable', 'no claimable intent', 'blocked', 'parked', 'running', 'recover', 'leftover']) {
      expect(selector, prefix).toMatch(new RegExp(`out\\.push\\([\\s\\S]{0,80}?[\`']${prefix}\\b`));
      expect(command, prefix).toContain(`\`${prefix}\``);
    }
  });

  // The check once read inferno-config.md only, so dashes in the README, a skill
  // stub and the scheduler never failed anything.
  it('no file under the flow carries an em or en dash', () => {
    const dash = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    const files = (readdirSync(INFERNO, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((file) => statSync(path.join(INFERNO, file)).isFile());
    // An empty walk (empty root, a Node that ignores `recursive`) must not pass.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('README.md');
    const offenders = files
      .flatMap((file) => readFileSync(path.join(INFERNO, file), 'utf8').split('\n')
        .map((line, at) => [file, at + 1, line] as const)
        .filter(([, , line]) => dash.test(line))
        .map(([name, at]) => `${name}:${at}`));
    expect(
      offenders,
      'Em or en dash (U+2014, U+2013) at the listed file:line. Replace each with a comma, a period or a plain hyphen.'
    ).toEqual([]);
  });

  // The flow text states rules; the incident that produced a rule stays out of it.
  it('no flow md file carries a date, a counted duration or a tally', () => {
    const spelled = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|' +
      'fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred';
    const narrative = [
      /\b20\d\d-\d\d-\d\d\b/,
      /\b\d{2,}\s+(?:minutes?|hours?|runs?|replies|reviews|rounds|calls|polls|times)\b/i,
      new RegExp(`\\b(?:${spelled})(?:[ -](?:${spelled}))?\\s+(?:minutes?|hours?|replies|reviews)\\b`, 'i'),
    ];
    const offenders = (readdirSync(INFERNO, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((file) => file.endsWith('.md'))
      .flatMap((file) => readFileSync(path.join(INFERNO, file), 'utf8').split('\n')
        .map((line, at) => [file, at + 1, line] as const)
        .filter(([, , line]) => narrative.some((pattern) => pattern.test(line)))
        .map(([name, at]) => `${name}:${at}`));
    expect(offenders).toEqual([]);
  });

  // Discover bundled suites so newly added safety regressions run in normal validation.
  const scriptSuites = (readdirSync(path.join(INFERNO, 'agents'), {
    recursive: true,
    encoding: 'utf8',
  }) as string[])
    .filter((file) => file.endsWith('.test.cjs'))
    .map((file) => path.join('agents', file))
    .sort();

  it('ships executable flow regression suites', () => {
    expect(scriptSuites.length).toBeGreaterThan(0);
  });

  // Each suite gets its own empty temp root and must leave it empty, so a dir any suite leaks,
  // by any route, fails the suite that leaked it.
  it.each(scriptSuites)('flow script suite %s passes and leaves no temp entry', (rel) => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'inferno-suite-'));
    try {
      // throws (and fails the test) on non-zero exit
      execFileSync(process.execPath, [path.join(INFERNO, rel)], {
        stdio: 'pipe',
        timeout: 180_000,
        env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
      });
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 185_000);

  // The flow's scripts execute inside consumer projects (Rust apps, static sites) that have
  // no node_modules, so a single `require('yaml')` would make the script throw at the exact
  // moment it is meant to save the ledger. Node builtins only.
  it.each([
    'agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs',
    'agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs',
  ])('%s requires nothing outside the Node stdlib', (rel) => {
    const source = readFileSync(path.join(INFERNO, rel), 'utf8');
    const required = [...source.matchAll(/\brequire\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    const external = required.filter(
      (id) => !id.startsWith('.') && !isBuiltin(id.replace(/^node:/, ''))
    );
    expect(external).toEqual([]);
  });

  it('inferno tree never references the FIRE artifact namespace', () => {
    const files = (readdirSync(INFERNO, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((f) => /\.(md|cjs|yaml|yml|hbs)$/.test(f));
    const offenders = files.filter((f) => {
      const c = readFileSync(path.join(INFERNO, f), 'utf8');
      return c.includes('.specs-fire') || c.includes('.specsmd/fire');
    });
    expect(offenders).toEqual([]);
  });

  it('the shipped INFERNO source contains no obsolete GPT-5.5 setting', () => {
    const files = (readdirSync(INFERNO, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((file) => /\.(md|toml|yaml|yml)$/.test(file));
    const offenders = files.filter((file) =>
      /gpt[- ]?5(?:\.| )?5/i.test(readFileSync(path.join(INFERNO, file), 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('FLOWS registers inferno', () => {
    const constants = readFileSync(path.join(ROOT, 'lib/constants.js'), 'utf8');
    expect(constants).toMatch(/inferno:\s*\{[\s\S]*?path:\s*'inferno'/);
  });
});
