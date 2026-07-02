const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { extractMemoryBankIntent } = require("./extract-memory-bank-intent.cjs");

// Build a throwaway memory-bank intent dir matching the AI-DLC schema
// (memory-bank.yaml: intents/{id}/units/{unit}/stories/{story}.md) so the
// parser is exercised against the real on-disk shape, not a hand-built object.
function writeFixtureIntent() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mb-extract-"));
  const intentDir = path.join(root, "intents", "011-vscode-extension");
  const unitDir = path.join(intentDir, "units", "sidebar-provider");
  const storiesDir = path.join(unitDir, "stories");
  fs.mkdirSync(storiesDir, { recursive: true });

  fs.writeFileSync(
    path.join(intentDir, "requirements.md"),
    [
      "---",
      "intent: vscode-extension",
      "status: construction",
      "---",
      "",
      "# Requirements: VS Code Extension",
      "",
      "## Intent Overview",
      "",
      "Create a VS Code extension that browses memory-bank artifacts.",
      "",
      "## Business Goals",
      "",
      "| Goal | Metric | Priority |",
      "|------|--------|----------|",
      "| Visual navigation | browse all artifacts | Must |",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(intentDir, "system-context.md"),
    [
      "---",
      "intent: vscode-extension",
      "phase: inception",
      "---",
      "",
      "# VS Code Extension - System Context",
      "",
      "## System Overview",
      "",
      "Runs entirely within VS Code, reading local files.",
      "",
    ].join("\n"),
  );

  // unit-brief is DISCARDED — present to prove the parser does not pull it in.
  fs.writeFileSync(
    path.join(unitDir, "unit-brief.md"),
    "# Unit Brief\n\nShould never appear in the extracted model.\n",
  );

  // Story A — frontmatter id differs from filename slug (real-world shape).
  fs.writeFileSync(
    path.join(storiesDir, "001-tree-data-provider.md"),
    [
      "---",
      "id: vscode-extension-story-sp-001",
      "unit: sidebar-provider",
      "intent: 011-vscode-extension",
      "status: complete",
      "priority: must",
      "---",
      "",
      "# Story: Tree Data Provider",
      "",
      "## User Story",
      "",
      "**As a** developer **I want** a tree data provider **So that** the sidebar renders.",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] **Given** a workspace, **When** activated, **Then** the provider registers",
      "- [ ] **Given** no memory-bank, **When** activated, **Then** an empty tree shows",
      "",
      "## Dependencies",
      "",
      "### Requires",
      "- None (first story)",
      "",
      "### Enables",
      "- 002-intent-unit-story-tree",
      "",
    ].join("\n"),
  );

  // Story B — Requires references both a bare slug and a unit-qualified slug.
  fs.writeFileSync(
    path.join(storiesDir, "002-intent-unit-story-tree.md"),
    [
      "---",
      "id: vscode-extension-story-sp-002",
      "unit: sidebar-provider",
      "intent: 011-vscode-extension",
      "status: complete",
      "priority: must",
      "---",
      "",
      "# Story: Intent/Unit/Story Tree",
      "",
      "## User Story",
      "",
      "**As a** developer **I want** a nested tree **So that** I can navigate.",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] **Given** Intents expanded, **When** getChildren() called, **Then** return all intents",
      "",
      "## Dependencies",
      "",
      "### Requires",
      "- 001-tree-data-provider",
      "- artifact-parser/003-artifact-parsing",
      "",
      "### Enables",
      "- User navigation",
      "",
    ].join("\n"),
  );

  return { root, intentDir };
}

test("extracts intent metadata from requirements + system-context", () => {
  const { root, intentDir } = writeFixtureIntent();
  try {
    const model = extractMemoryBankIntent(intentDir);
    assert.equal(model.intent.id, "011-vscode-extension");
    assert.equal(model.intent.slug, "vscode-extension");
    assert.ok(
      model.intent.requirements.includes("VS Code extension"),
      "requirements body retained for brief rendering",
    );
    assert.ok(
      model.intent.system_context.includes("within VS Code"),
      "system-context body retained for brief rendering",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lists every unit and never pulls unit-brief prose into the model", () => {
  const { root, intentDir } = writeFixtureIntent();
  try {
    const model = extractMemoryBankIntent(intentDir);
    assert.deepEqual(model.units, ["sidebar-provider"]);
    const serialized = JSON.stringify(model);
    assert.ok(
      !serialized.includes("never appear"),
      "unit-brief content must be discarded, not carried",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("emits one story record per story file with id, unit, ac, edges and source path", () => {
  const { root, intentDir } = writeFixtureIntent();
  try {
    const model = extractMemoryBankIntent(intentDir);
    assert.equal(model.stories.length, 2);

    const byId = Object.fromEntries(model.stories.map((s) => [s.id, s]));
    const first = byId["001-tree-data-provider"];
    const second = byId["002-intent-unit-story-tree"];

    assert.ok(first, "story id is derived from filename slug, not frontmatter id");
    assert.ok(second);

    assert.equal(first.unit, "sidebar-provider");
    assert.equal(first.frontmatter_id, "vscode-extension-story-sp-001");
    assert.equal(first.acceptance_criteria.length, 2);
    assert.match(first.acceptance_criteria[0], /the provider registers/);

    // source_path is relative to the intent dir and points at the real story file
    assert.ok(
      first.source_path.endsWith(
        "units/sidebar-provider/stories/001-tree-data-provider.md",
      ),
      "source_path is the linkable context.required target",
    );

    // prose retained verbatim (skill links it; it is NOT re-summarized downstream)
    assert.ok(first.body.includes("## User Story"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("normalizes Requires edges to in-intent story ids and drops None / cross-unit prefixes", () => {
  const { root, intentDir } = writeFixtureIntent();
  try {
    const model = extractMemoryBankIntent(intentDir);
    const byId = Object.fromEntries(model.stories.map((s) => [s.id, s]));

    // "None (first story)" yields no edges
    assert.deepEqual(byId["001-tree-data-provider"].depends_on, []);

    // bare slug stays; unit-qualified "artifact-parser/003-artifact-parsing"
    // is normalized to its story-id tail so it matches an emitted work-item id
    assert.deepEqual(byId["002-intent-unit-story-tree"].depends_on, [
      "001-tree-data-provider",
      "003-artifact-parsing",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("throws a clear error when the intent dir has no requirements.md", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mb-extract-empty-"));
  const intentDir = path.join(root, "intents", "099-empty");
  fs.mkdirSync(intentDir, { recursive: true });
  try {
    assert.throws(() => extractMemoryBankIntent(intentDir), /requirements\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
