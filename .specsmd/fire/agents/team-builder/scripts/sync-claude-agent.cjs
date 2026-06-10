#!/usr/bin/env node
// Materializes the canonical team-builder procedure (../agent.md body) into
// .claude/agents/specsmd-fire-team-builder.md, whose body is the builder
// subagent's system prompt on Claude Code. The target's frontmatter is
// preserved (model pins etc. are per-repo, host-adapter concerns).
//
//   node sync-claude-agent.cjs          regenerate the target
//   node sync-claude-agent.cjs --check  exit 1 if the target is out of sync
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SOURCE = path.join(ROOT, '.specsmd', 'fire', 'agents', 'team-builder', 'agent.md');
const TARGET = path.join(ROOT, '.claude', 'agents', 'specsmd-fire-team-builder.md');
const MARKER =
  '<!-- GENERATED from .specsmd/fire/agents/team-builder/agent.md - edit there, then run: node .specsmd/fire/agents/team-builder/scripts/sync-claude-agent.cjs -->';
const DEFAULT_FRONTMATTER = [
  '---',
  'name: specsmd-fire-team-builder',
  'description: Use when a FIRE team orchestrator assigns exactly one work item with context manifest and editable ownership.',
  'tools: Read, Write, Edit, MultiEdit, Bash, Grep, Glob, TodoWrite',
  '---',
].join('\n');

function splitFrontmatter(text) {
  const m = text.match(/^---\n[\s\S]*?\n---\n/);
  if (!m) throw new Error('no frontmatter block found');
  return { frontmatter: m[0].trimEnd(), body: text.slice(m[0].length).trim() };
}

const source = splitFrontmatter(fs.readFileSync(SOURCE, 'utf8'));
const frontmatter = fs.existsSync(TARGET)
  ? splitFrontmatter(fs.readFileSync(TARGET, 'utf8')).frontmatter
  : DEFAULT_FRONTMATTER;
const expected = `${frontmatter}\n\n${MARKER}\n\n${source.body}\n`;

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (actual !== expected) {
    console.error(`OUT OF SYNC: ${path.relative(ROOT, TARGET)} does not match ${path.relative(ROOT, SOURCE)}; run sync-claude-agent.cjs`);
    process.exit(1);
  }
  console.log('in sync');
} else {
  fs.writeFileSync(TARGET, expected);
  console.log(`wrote ${path.relative(ROOT, TARGET)} (${expected.length} bytes)`);
}
