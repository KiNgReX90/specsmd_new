/**
 * Deterministic extraction core for the inception-import converter skill.
 *
 * Reads a COMPLETED AI-DLC memory-bank intent directory (the on-disk shape
 * defined in `src/flows/aidlc/memory-bank.yaml`):
 *
 *   intents/{intent-id}/
 *   ├── requirements.md         (intent goal/users/problem — REQUIRED)
 *   ├── system-context.md       (actors/externals — optional)
 *   └── units/{unit}/
 *       ├── unit-brief.md       (DISCARDED — never read into the model)
 *       └── stories/{NNN}-*.md  (one story per file)
 *
 * and produces a structured, JSON-serializable model:
 *
 *   {
 *     intent: { id, slug, requirements, system_context },
 *     units:  [unit-name, ...],
 *     stories:[{ id, frontmatter_id, unit, title, priority, status,
 *                acceptance_criteria[], depends_on[], body, source_path }, ...]
 *   }
 *
 * This is the MECHANICAL parse only. All reasoning — concrete path resolution,
 * kind/complexity inference, contract enforcement, unresolved-story flagging —
 * lives in SKILL.md (the planner tier), so this module stays unit-testable in
 * isolation and importable by downstream items (converter-extraction-test).
 *
 * No FIRE-namespace references; no INFERNO state mutation; pure read + parse.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Split YAML frontmatter from body. Returns { frontmatter, body }. */
function splitFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  return {
    frontmatter: parseFlatYaml(match[1]),
    body: content.slice(match[0].length),
  };
}

/** Minimal flat `key: value` YAML reader (frontmatter is always flat here). */
function parseFlatYaml(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * Extract the body of a `## Section` (until the next `##`/`#` heading or EOF).
 * Case-insensitive on the heading text. Returns "" when the section is absent.
 */
function sectionBody(body, heading) {
  const lines = body.split("\n");
  const wanted = heading.toLowerCase();
  let capturing = false;
  let depth = 0;
  const out = [];
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const title = h[2].trim().toLowerCase();
      if (capturing && level <= depth) break;
      if (!capturing && title === wanted) {
        capturing = true;
        depth = level;
        continue;
      }
    }
    if (capturing) out.push(line);
  }
  return out.join("\n").trim();
}

/** Parse Given/When/Then acceptance-criteria list items into plain strings. */
function parseAcceptanceCriteria(body) {
  const section = sectionBody(body, "Acceptance Criteria");
  if (!section) return [];
  return section
    .split("\n")
    .map((line) => line.match(/^\s*-\s*(?:\[[ xX]\]\s*)?(.+)$/))
    .filter(Boolean)
    .map((m) => m[1].replace(/\*\*/g, "").trim())
    .filter((text) => text.length > 0);
}

/** A story id used in a Requires edge: "None (...)" is empty; non-stories drop. */
const NULL_EDGE = /^none\b/i;

/**
 * Normalize a Requires/Depends edge to an in-intent story id so it lines up
 * with the emitted work-item ids (which use the story-id tail). A unit-qualified
 * reference like `artifact-parser/003-artifact-parsing` collapses to its tail.
 * Returns null for "None"/prose lines that are not story references.
 */
function normalizeEdge(raw) {
  let text = raw.replace(/\*\*/g, "").trim();
  if (!text || NULL_EDGE.test(text)) return null;
  // strip a parenthetical description: "001-foo (Foo bar)" -> "001-foo"
  text = text.replace(/\s*\(.*\)\s*$/, "").trim();
  // unit-qualified -> story-id tail
  if (text.includes("/")) {
    text = text.split("/").pop().trim();
  }
  // only keep things that look like a story id (NNN-slug); else it is prose
  // ("User navigation") and is not a dependency edge.
  if (!/^\d{1,4}-[a-z0-9]/i.test(text)) return null;
  return text;
}

/** Parse the `### Requires` edges under `## Dependencies`. */
function parseDependsOn(body) {
  const deps = sectionBody(body, "Dependencies");
  if (!deps) return [];
  // isolate the Requires subsection (### Requires ... until next ###/##/#)
  const lines = deps.split("\n");
  let capturing = false;
  const edges = [];
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const title = h[2].trim().toLowerCase();
      capturing = title === "requires";
      continue;
    }
    if (!capturing) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (!item) continue;
    const edge = normalizeEdge(item[1]);
    if (edge && !edges.includes(edge)) edges.push(edge);
  }
  return edges;
}

/** Filename `NNN-title-slug.md` -> story id `NNN-title-slug`. */
function storyIdFromFile(file) {
  return path.basename(file, ".md");
}

/** First markdown H1 title text, falling back to the story id. */
function titleFromBody(body, fallback) {
  const m = body.match(/^#\s+(?:Story:\s*)?(.+)$/m);
  return m ? m[1].trim() : fallback;
}

/**
 * Parse a single story file at `absPath` (relative to `intentDir` for the
 * linkable source_path).
 */
function parseStory(absPath, intentDir, unit) {
  const content = fs.readFileSync(absPath, "utf8");
  const { frontmatter, body } = splitFrontmatter(content);
  const id = storyIdFromFile(absPath);
  return {
    id,
    frontmatter_id: frontmatter.id || null,
    unit,
    title: titleFromBody(body, id),
    priority: frontmatter.priority || null,
    status: frontmatter.status || null,
    acceptance_criteria: parseAcceptanceCriteria(body),
    depends_on: parseDependsOn(body),
    body: body.trim(),
    source_path: path.relative(intentDir, absPath).split(path.sep).join("/"),
  };
}

/** List immediate subdirectory names of `dir` (sorted), [] when dir absent. */
function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** List `*.md` files in `dir` (sorted), [] when dir absent. */
function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

/**
 * Extract a structured model from a completed memory-bank intent directory.
 *
 * @param {string} intentDir absolute or cwd-relative path to
 *   `memory-bank/intents/{intent-id}/`
 * @returns {{intent: object, units: string[], stories: object[]}}
 * @throws if the directory is missing `requirements.md`.
 */
function extractMemoryBankIntent(intentDir) {
  const requirementsPath = path.join(intentDir, "requirements.md");
  if (!fs.existsSync(requirementsPath)) {
    throw new Error(
      `inception-import: ${intentDir} is not a completed memory-bank intent (no requirements.md)`,
    );
  }

  const requirementsRaw = fs.readFileSync(requirementsPath, "utf8");
  const requirements = splitFrontmatter(requirementsRaw);

  const systemContextPath = path.join(intentDir, "system-context.md");
  const system_context = fs.existsSync(systemContextPath)
    ? splitFrontmatter(fs.readFileSync(systemContextPath, "utf8")).body.trim()
    : "";

  const id = path.basename(intentDir);
  const slug =
    requirements.frontmatter.intent ||
    splitFrontmatter(system_context ? systemContextPath : requirementsRaw)
      .frontmatter.intent ||
    id.replace(/^\d+-/, "");

  const unitsDir = path.join(intentDir, "units");
  const units = listDirs(unitsDir);

  const stories = [];
  for (const unit of units) {
    const storiesDir = path.join(unitsDir, unit, "stories");
    for (const file of listMarkdown(storiesDir)) {
      stories.push(parseStory(path.join(storiesDir, file), intentDir, unit));
    }
  }
  // stable, deterministic ordering by story id
  stories.sort((a, b) => a.id.localeCompare(b.id));

  return {
    intent: {
      id,
      slug,
      requirements: requirements.body.trim(),
      system_context,
    },
    units,
    stories,
  };
}

module.exports = {
  extractMemoryBankIntent,
  // exported for focused unit coverage and reuse by SKILL-driven steps
  splitFrontmatter,
  sectionBody,
  parseAcceptanceCriteria,
  parseDependsOn,
  normalizeEdge,
};
