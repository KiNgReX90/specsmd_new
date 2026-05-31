const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const YAML = require('yaml');

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function resolveRoot(root = process.cwd()) {
  return path.resolve(root);
}

function statePath(root = process.cwd()) {
  return path.join(resolveRoot(root), '.specs-fire', 'state.yaml');
}

function intentsDir(root = process.cwd()) {
  return path.join(resolveRoot(root), '.specs-fire', 'intents');
}

function readState(root = process.cwd()) {
  const file = statePath(root);
  if (!fs.existsSync(file)) return null;
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

function writeState(root, state) {
  fs.writeFileSync(statePath(root), YAML.stringify(state));
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return {
    frontmatter: YAML.parse(match[1]) || {},
    body: content.slice(match[0].length),
  };
}

function buildMarkdown(frontmatter, body) {
  return `---\n${YAML.stringify(frontmatter)}---${body}`;
}

function readMarkdownFrontmatter(file) {
  if (!fs.existsSync(file)) return null;
  const parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return parsed ? parsed.frontmatter : null;
}

function findIntent(state, intentId) {
  return arr(state?.intents).find((intent) => intent?.id === intentId) || null;
}

function findWorkItem(state, intentId, itemId) {
  const intent = findIntent(state, intentId);
  return arr(intent?.work_items).find((item) => item?.id === itemId) || null;
}

function workItemPath(root, intentId, itemId) {
  return path.join(intentsDir(root), intentId, 'work-items', `${itemId}.md`);
}

function briefPath(root, intentId) {
  return path.join(intentsDir(root), intentId, 'brief.md');
}

function statusCounts(items) {
  const counts = { pending: 0, in_progress: 0, completed: 0, blocked: 0, other: 0 };
  for (const item of arr(items)) {
    if (Object.prototype.hasOwnProperty.call(counts, item?.status)) {
      counts[item.status] += 1;
    } else {
      counts.other += 1;
    }
  }
  return counts;
}

function scanDisk(root = process.cwd()) {
  const base = intentsDir(root);
  const result = { intents: [], workItems: new Map() };
  if (!fs.existsSync(base)) return result;

  for (const dirent of fs.readdirSync(base, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const intentId = dirent.name;
    const brief = briefPath(root, intentId);
    if (!fs.existsSync(brief)) continue;
    result.intents.push(intentId);

    const workItemsPath = path.join(base, intentId, 'work-items');
    const items = fs.existsSync(workItemsPath)
      ? fs
          .readdirSync(workItemsPath, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('-design.md'))
          .map((entry) => entry.name.replace(/\.md$/, ''))
          .sort()
      : [];
    result.workItems.set(intentId, items);
  }

  result.intents.sort();
  return result;
}

function normalizeAscii(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function slugTitle(title) {
  return normalizeAscii(title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function uniqueSlug(title, used) {
  const base = slugTitle(title) || 'work-item';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function execGit(args, options = {}) {
  const output = childProcess.execFileSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  return typeof output === 'string' ? output.trim() : '';
}

function safeBranchToken(value) {
  return slugTitle(value).slice(0, 80) || 'intent';
}

function isCompletedIntent(intent) {
  if (!intent) return false;
  const items = arr(intent.work_items);
  if (items.length > 0) return items.every((item) => item.status === 'completed');
  return intent.status === 'completed';
}

module.exports = {
  arr,
  briefPath,
  buildMarkdown,
  execGit,
  findIntent,
  findWorkItem,
  intentsDir,
  isCompletedIntent,
  parseFrontmatter,
  readMarkdownFrontmatter,
  readState,
  resolveRoot,
  safeBranchToken,
  scanDisk,
  slugTitle,
  statePath,
  statusCounts,
  uniqueSlug,
  workItemPath,
  writeState,
};
