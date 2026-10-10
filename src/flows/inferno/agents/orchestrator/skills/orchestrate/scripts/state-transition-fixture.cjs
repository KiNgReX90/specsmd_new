// Shared ledgers and sandboxes for the state-transition suites. Every sandbox dir is removed at exit.
const fs = require("node:fs");
const path = require("node:path");

const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

// Mirrors the real artifacts: load-bearing comment blocks, quoted and unquoted titles,
// and per-entry field order that differs between intents (status before/after kind).
const FIXTURE = `project:
  name: demo
  created: 2026-07-01T00:00:00Z
workspace:
  type: brownfield
intents:
  - id: tools-menu
    title: "Global tools menu"
    status: in_progress
    claimed_at: 2026-07-13T06:44:12Z
    claimed_by: inferno-intent/tools-menu-20260713-064412
    # Captured 2026-07-13. This comment block is load-bearing: it carries the
    # capture rationale and must survive every transition.
    # INTENT. the menu and its wiring cannot be tested before the shell lands.
    created: 2026-07-13
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: menu-shell
        title: "Menu shell"
        kind: ui
        complexity: low
        mode: autopilot
        status: pending
        depends_on: []
        review: clean
      - id: menu-wiring
        title: "Menu wiring"
        status: pending
        complexity: medium
        mode: autopilot
        depends_on: [menu-shell]
        review: clean
  - id: already-shipped
    title: Prior intent
    status: completed
    completed_at: 2026-07-01T10:00:00Z
    work_items:
      - id: only-item
        title: Only item
        status: completed
        depends_on: []
runs:
  active: []
`;

/** Lines present in `a` that `b` does not account for, respecting duplicates. */
function multisetDifference(a, b) {
  const pool = [...b];
  const out = [];
  for (const line of a) {
    const at = pool.indexOf(line);
    if (at === -1) out.push(line);
    else pool.splice(at, 1);
  }
  return out;
}

function sandbox(content = FIXTURE) {
  const dir = tempDir("inferno-state-");
  const file = path.join(dir, "state.yaml");
  writeFile(file, content, "utf8");
  return { dir, file };
}

const NOW = "2026-07-14T12:00:00Z";

/** The archive beside a ledger, where a shipped prerequisite answers from. */
function withArchive(box, ids = ["long-gone"]) {
  fs.mkdirSync(path.join(box.dir, "archive"), { recursive: true });
  writeFile(
    path.join(box.dir, "archive", "state.yaml"),
    `intents:\n${ids.map((id) => `  - id: ${id}\n    status: completed\n`).join("")}`,
    "utf8",
  );
  return box;
}

// A ledger at the moment a run picks its intent: one claimable intent, one already
// claimed by another run, one waiting on a prerequisite that has not shipped.
const CLAIMABLE = `project:
  name: demo
intents:
  - id: ready-one
    title: "Ready one"
    status: pending
    created: 2026-07-10
    base_branch: main
    depends_on_intents: [long-gone]
    # Capture rationale that must survive the claim.
    work_items:
      - id: ready-item
        title: "Ready item"
        status: pending
        depends_on: []
  - id: taken
    title: "Taken"
    status: in_progress
    claimed_at: 2026-07-11T09:00:00Z
    claimed_by: inferno-intent/taken-20260711T090000Z
    depends_on_intents: []
    work_items:
      - id: taken-item
        title: "Taken item"
        status: pending
        depends_on: []
  - id: waiting
    title: "Waiting"
    status: pending
    depends_on_intents: [blocker]
    work_items:
      - id: waiting-item
        title: "Waiting item"
        status: pending
        depends_on: []
  - id: blocker
    title: "Blocker"
    status: pending
    depends_on_intents: []
    work_items:
      - id: blocker-item
        title: "Blocker item"
        status: pending
        depends_on: []
`;

const RUN = "inferno-intent/ready-one-20260714T120000Z";

module.exports = { FIXTURE, multisetDifference, sandbox, NOW, withArchive, CLAIMABLE, RUN };
