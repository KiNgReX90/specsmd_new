const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { check } = require("./state-transition.cjs");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

// An intent rests on one of the triage criteria, and a batch is the first of them (2026-10-21).
// The reason on the INTENT. line opens with the letter of the criterion that holds, so a script
// can tell a criterion from a request. An order, a preference and a deadline name none.

const WRITER = path.join(__dirname, "state-transition.cjs");
const CUTOVER = "2026-03-10T09:00:00.000Z";

const entry = (id, created, comment, extra = "") => `  - id: ${id}
    title: "One change"
    status: pending
${created ? `    created: ${created}\n` : ""}    depends_on_intents: []
${extra}    comment: |
      Captured from a request. One attribute plus its test.
${comment.map((line) => `      ${line}\n`).join("")}    work_items:
      - id: ${id}-item
        title: "The change"
        status: pending
        depends_on: []
`;

/** A host: the ledger where the flow keeps it, beside the install record that holds the cutover. */
function host(entries, since = CUTOVER) {
  const root = tempDir("inferno-triage-");
  const file = path.join(root, ".specs-inferno", "state.yaml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(root, ".specsmd", "inferno"), { recursive: true });
  writeFile(file, `intents:\n${entries.join("")}`, "utf8");
  if (since !== null) {
    const lock = { flow: "inferno", rules: since === "none" ? {} : { triage: since }, files: {} };
    writeFile(path.join(root, ".specsmd", "inferno", "flow.lock"), `${JSON.stringify(lock)}\n`, "utf8");
  }
  return file;
}

const AFTER = "2026-03-11";
const BEFORE = "2026-03-09";
const ORDER = "INTENT. the owner ordered this batch run as intents";

test("check refuses a reason that cites an order and names no criterion", () => {
  const drift = check({ file: host([entry("ordered", AFTER, [ORDER])]) }).drift;

  assert.equal(drift.length, 1);
  assert.equal(drift[0].intent, "ordered");
  assert.equal(drift[0].kind, "intent-without-exception-reason");
  assert.match(drift[0].detail, /names no criterion: "the owner ordered this batch run as intents"/);
});

test("the refusal prints the fix: the letter form, each criterion, and the direct build", () => {
  const detail = check({ file: host([entry("ordered", AFTER, [ORDER])]) }).drift[0].detail;

  assert.match(detail, /INTENT\. \(c\) </, "the form to write");
  for (const letter of ["a", "c", "d", "e"]) assert.match(detail, new RegExp(`\\(${letter}\\) \\w`), letter);
  assert.match(detail, /request, an order, a preference or a deadline/);
  assert.match(detail, /drop the intent and return it as a direct build/);
});

test("check refuses every other reason that is a wish and not a criterion", () => {
  for (const reason of [
    "INTENT. requested as an intent so the run shows up on the board",
    "INTENT. preferred shape for this kind of work in this repository",
    "INTENT. part of the manual test batch that ships this week",
    "INTENT. a persisted format migration the cheap checks cannot prove piecemeal",
  ]) {
    const drift = check({ file: host([entry("wished", AFTER, [reason])]) }).drift;
    assert.equal(drift.length, 1, reason);
    assert.match(drift[0].detail, /names no criterion/, reason);
  }
});

test("check accepts a reason that opens with the criterion that holds", () => {
  for (const reason of [
    "INTENT. (c) the wiring cannot be tested before the shell lands",
    "INTENT. (d) the native tree and the renderer tree compile apart",
    "INTENT. (e) a persisted format migration the gate must prove whole",
    "INTENT. (e) and (c): the gates must land before the switch flips",
    "INTENT. (c), (d) and (e) the chain spans two trees and one migration",
    "BOX. (c) the wiring cannot be tested before the shell lands",
    "# INTENT. (c) the wiring cannot be tested before the shell lands",
  ]) {
    assert.deepEqual(check({ file: host([entry("named", AFTER, [reason])]) }).drift, [], reason);
  }
});

test("check accepts a batch under criterion (a)", () => {
  for (const reason of ["INTENT. (a) ten findings from the hand test across three screens", "INTENT. (a) a board of decisions that touches the dashboard and the export"]) {
    assert.deepEqual(check({ file: host([entry("batch", AFTER, [reason])]) }).drift, [], reason);
  }
});

test("check refuses a letter the triage does not carry", () => {
  for (const reason of ["INTENT. (b) the change spans the native and the renderer tree", "INTENT. (z) the wiring cannot land before the shell"]) {
    const drift = check({ file: host([entry("lettered", AFTER, [reason])]) }).drift;
    assert.equal(drift.length, 1, reason);
    assert.match(drift[0].detail, /names no criterion/, reason);
  }
});

test("a criterion letter does not carry a reason that only restates size", () => {
  const drift = check({ file: host([entry("sized", AFTER, ["INTENT. (c) six files and two mechanisms"])]) }).drift;

  assert.equal(drift.length, 1);
  assert.match(drift[0].detail, /only restates size/);
});

test("a note line beside the reason does not hide the reason", () => {
  const note = "CROSS-INTENT. no file shared with the other open intent";
  const named = "INTENT. (c) the wiring cannot be tested before the shell lands";

  assert.deepEqual(check({ file: host([entry("noted", AFTER, [note, named])]) }).drift, []);
  const drift = check({ file: host([entry("noted", AFTER, [note, ORDER])]) }).drift;
  assert.equal(drift.length, 1);
  assert.match(drift[0].detail, /names no criterion: "the owner ordered/);
});

test("an intent with no reason line is told the form to write", () => {
  const drift = check({ file: host([entry("bare", AFTER, [])]) }).drift;

  assert.equal(drift.length, 1);
  assert.match(drift[0].detail, /no INTENT\. line/);
  assert.match(drift[0].detail, /INTENT\. \(c\) </);
});

// The rule starts per host at the install that first carried it. An entry captured before
// that moment was written under the rule of its day and keeps the answer it had then.

test("an entry captured before the cutover keeps the answer it had", () => {
  const before = [
    entry("ordered-before", BEFORE, [ORDER]),
    entry("chain-before", BEFORE, ["CROSS-INTENT. no file shared with the other open intent"]),
    entry("plain-before", "2026-03-10", ["INTENT. the change must not reach the branch before the gate"]),
  ];

  assert.deepEqual(check({ file: host(before) }).drift, []);
});

test("an entry captured before the cutover is still held to the rule of its day", () => {
  const drift = check({ file: host([
    entry("sized-before", BEFORE, ["INTENT. six files and two mechanisms"]),
    entry("bare-before", BEFORE, []),
  ]) }).drift;

  assert.deepEqual(drift.map((line) => line.intent), ["sized-before", "bare-before"]);
  assert.match(drift[0].detail, /only restates size/);
  assert.doesNotMatch(drift[1].detail, /\(c\)/, "the old line, word for word");
});

test("the cutover is per entry: the new one is refused beside the old one", () => {
  const drift = check({ file: host([entry("old", BEFORE, [ORDER]), entry("new", AFTER, [ORDER])]) }).drift;

  assert.deepEqual(drift.map((line) => line.intent), ["new"]);
});

test("an entry with no creation date is held to the criterion", () => {
  const drift = check({ file: host([entry("undated", null, [ORDER])]) }).drift;

  assert.equal(drift.length, 1);
  assert.match(drift[0].detail, /names no criterion/);
});

test("a host whose install record holds no cutover holds every entry to the criterion and says so", () => {
  for (const since of [null, "none"]) {
    const drift = check({ file: host([entry("ordered", BEFORE, [ORDER])], since) }).drift;
    assert.equal(drift.length, 1);
    assert.match(drift[0].detail, /names no criterion/);
    assert.match(drift[0].detail, /flow\.lock records no triage cutover/);
  }
});

test("an intent a run already holds is never asked for a criterion", () => {
  const held = entry("held", AFTER, [ORDER]).replace("status: pending", "status: in_progress");

  assert.deepEqual(check({ file: host([held]) }).drift, []);
});

test("the check command prints the fix and exits 1", () => {
  const file = host([entry("ordered", AFTER, [ORDER])]);
  const result = spawnSync(process.execPath, [WRITER, "check", "--file", file], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /^DRIFT ordered: the INTENT\. reason names no criterion/);
  assert.match(result.stdout, /return it as a direct build/);
});
