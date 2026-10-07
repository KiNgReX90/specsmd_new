const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { reviewItem, completeItem } = require("./state-transition.cjs");
const { hostLock } = require("./review-fixture.cjs");

const WRITER = path.join(__dirname, "state-transition.cjs");
const HASH = "a".repeat(64);
const NOW = "2026-10-06T12:00:00Z";

const FIXTURE = `intents:
  - id: alpha
    title: "Alpha"
    status: in_progress
    # load-bearing comment
    work_items:
      - id: a-one
        title: "A one"
        complexity: low
        status: pending
        depends_on: []
      - id: a-two
        title: "A two"
        status: completed
        completed_at: 2026-09-01T00:00:00Z
        depends_on: []
`;

/** The review file a fix verdict is weighed by, with one finding of `severity`. */
const REVIEW_FILE = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const findingOf = (severity, extra = "") =>
  `item: a-one\nverdict: fix\nfiles: [src/a.ts]\nfindings:\n  - criterion: c\n    file: src/a.ts\n    line: "1"\n` +
  `    evidence: e\n    fix: f\n    severity: ${severity}\n${extra}`;
const reviewFile = (file, body) => fs.writeFileSync(path.join(path.dirname(path.dirname(file)), REVIEW_FILE), body);

/**
 * A host root with a ledger, a fix review of a-one with one major finding and, unless `lock`
 * is null, the install lock and its cutover.
 */
function sandbox(content = FIXTURE, lock = "2026-09-20T00:00:00.000Z") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-review-writer-"));
  const file = path.join(dir, ".specs-inferno", "state.yaml");
  fs.mkdirSync(path.join(dir, path.dirname(REVIEW_FILE)), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, REVIEW_FILE), findingOf("major"));
  fs.writeFileSync(file, content);
  if (lock !== null) {
    fs.mkdirSync(path.join(dir, ".specsmd", "inferno"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".specsmd", "inferno", "flow.lock"), hostLock(lock));
  }
  return { file };
}

const review = (file, extra = {}) =>
  reviewItem({ file, intent: "alpha", item: "a-one", verdict: "fix", files_hash: HASH, tier: "cheap", commit: "abc1234", now: NOW, ...extra });

const block = (file) => {
  const text = fs.readFileSync(file, "utf8");
  return text.slice(text.indexOf("- id: a-one"), text.indexOf("- id: a-two"));
};

test("review-item writes the verdict, the hash, the commit, the tier and the count under status", () => {
  const { file } = sandbox();
  const result = review(file);

  assert.equal(result.changed, true);
  assert.equal(result.rejections, 1);
  assert.match(
    block(file),
    new RegExp(
      `status: pending\\n\\s+review: fix\\n\\s+review_hash: ${HASH}\\n\\s+review_commit: abc1234\\n` +
        `\\s+review_tier: cheap\\n\\s+review_rejections: 1\\n\\s+review_weight: serious\\n\\s+reviewed_at: ${NOW}`,
    ),
  );
  assert.match(fs.readFileSync(file, "utf8"), /# load-bearing comment/);
});

test("review-item counts rejections per tier and starts over when the tier changes", () => {
  const { file } = sandbox();
  review(file);
  assert.equal(review(file, { tier: "strong" }).rejections, 1);
  assert.equal(review(file, { tier: "strong" }).rejections, 2);
  assert.equal(review(file, { tier: "strong", verdict: "clean" }).rejections, 2);
  assert.equal(review(file, { tier: "escalate", verdict: "clean" }).rejections, 0);
  assert.equal((block(file).match(/review_rejections:/g) || []).length, 1, "one line per field");
});

test("a minor-only fix review keeps the count, and a repeat finding weighs repeat whatever it counts", () => {
  const { file } = sandbox();
  review(file, { tier: "strong" });
  reviewFile(file, findingOf("minor"));
  const minor = review(file, { tier: "strong" });
  assert.equal(minor.rejections, 1);
  assert.equal(minor.weight, "minor");
  reviewFile(file, findingOf("minor", "    repeat: true\n"));
  assert.deepEqual([review(file, { tier: "strong" }).rejections, block(file).match(/review_weight: (\w+)/)[1]], [1, "repeat"]);
  reviewFile(file, findingOf("blocker", "    repeat: true\n"));
  assert.equal(review(file, { tier: "strong" }).rejections, 2);
  assert.equal(review(file, { tier: "strong", verdict: "clean" }).weight, "none");
});

test("review-item weighs a fix only by its review file, and refuses one it cannot read", () => {
  const { file } = sandbox();
  fs.rmSync(path.join(path.dirname(path.dirname(file)), REVIEW_FILE));
  const root = path.dirname(path.dirname(path.resolve(file)));
  assert.throws(() => review(file), (error) => error.code === "NO_REVIEW_FILE" && error.message === "refusing review-item: a fix verdict is " +
    `weighed by the findings in ${REVIEW_FILE}, which cannot be read. Record the review through run.cjs review --item a-one ` +
    `--reviewer <agent-id> --tree ${root} --intent alpha, which validates the file first.`);
  reviewFile(file, findingOf("major").replace("verdict: fix", "verdict: clean").replace(/findings:[\s\S]*/, ""));
  assert.throws(() => review(file), (error) => error.code === "VERDICT_MISMATCH" && /says clean/.test(error.message));
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /review:/);
});

test("review-item refuses a verdict, a hash, a tier or a commit it cannot use", () => {
  const { file } = sandbox();
  assert.throws(() => review(file, { verdict: "maybe" }), /BAD_VERDICT|clean or fix/);
  assert.throws(() => review(file, { files_hash: "abc" }), /64/);
  assert.throws(() => review(file, { tier: "oracle" }), /cheap, strong or escalate/);
  assert.throws(() => review(file, { commit: "" }), /commit/);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /review:/);
});

test("review-item is reachable through the CLI", () => {
  const { file } = sandbox();
  const result = spawnSync(process.execPath, [
    WRITER, "review-item", "--intent", "alpha", "--item", "a-one", "--verdict", "clean",
    "--files-hash", HASH, "--tier", "cheap", "--commit", "abc1234", "--file", file,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reviewed a-one clean/);
  assert.match(fs.readFileSync(file, "utf8"), /review: clean/);
});

// --- the backstop -------------------------------------------------------------

test("complete-item refuses an item with no clean review and names the command", () => {
  const { file } = sandbox();
  assert.throws(
    () => completeItem({ file, intent: "alpha", item: "a-one", proof: "abc1234", now: NOW }),
    (error) => error.code === "REVIEW_OWED" && /run\.cjs review --item a-one/.test(error.message),
  );
  review(file);
  assert.throws(
    () => completeItem({ file, intent: "alpha", item: "a-one", proof: "abc1234", now: NOW }),
    (error) => error.code === "REVIEW_OWED",
    "a fix verdict is not clean",
  );
  assert.doesNotMatch(block(file), /integrated_sha/);
});

test("complete-item completes an item whose review is clean", () => {
  const { file } = sandbox();
  review(file, { verdict: "clean" });
  const result = completeItem({ file, intent: "alpha", item: "a-one", proof: "abc1234", now: NOW });
  assert.equal(result.changed, true);
});

const backfill = (file) => completeItem({ file, intent: "alpha", item: "a-two", proof: "abc1234", now: NOW });

test("complete-item backfills the proof of an item completed before this host's review cutover", () => {
  assert.equal(backfill(sandbox().file).changed, true);
});

test("complete-item holds an item completed after this host's review cutover to its review", () => {
  const { file } = sandbox(FIXTURE, "2026-08-01T00:00:00.000Z");
  assert.throws(() => backfill(file), (error) => error.code === "REVIEW_OWED");
});

test("an item completed with no completed_at predates the cutover", () => {
  const { file } = sandbox(FIXTURE.replace("        completed_at: 2026-09-01T00:00:00Z\n", ""));
  assert.equal(backfill(file).changed, true);
});

test("with no cutover in the host lock every item owes a review, and the refusal names a reinstall", () => {
  const { file } = sandbox(FIXTURE, null);
  assert.throws(() => backfill(file), (error) => error.code === "REVIEW_OWED" && /reinstall the flow/.test(error.message));
});
