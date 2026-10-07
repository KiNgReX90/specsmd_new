const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");

// The scan is owed before the intent review on both hosts, and the review answers every line
// the collected scan holds.

const CODEX = ".specs-inferno/config.codex.yaml";
const REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const INSTALLED = {
  ".claude/agents/specsmd-inferno-scanner.md": "---\nname: specsmd-inferno-scanner\n---\n",
  ".codex/agents/specsmd_inferno_scanner.toml": 'name = "specsmd_inferno_scanner"\n',
  [CODEX]: "roles:\n  scanner:\n    model: model-codex-scan\n",
};

function started() {
  const fixture = repo({ files: INSTALLED });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  return { fixture, tree };
}

test("on Codex the review owes the scan through the scanner role, and its refusal prints the fix", () => {
  const { fixture, tree } = started();
  const result = run(fixture, ["review", "--tree", tree, "--config", CODEX]);
  assert.equal(result.code, 3, result.out + result.err);
  const config = `--config ${CODEX.replace(/[.]/g, "\\.")}`;
  assert.match(result.out, new RegExp(`run run\\.cjs scan --tree ${tree} ${config}`));
  assert.match(result.out, /spawn the dispatch lines it prints/);
  assert.match(result.out, new RegExp(`run\\.cjs scan --collect --tree ${tree} ${config}`));
  assert.doesNotMatch(result.out, /dispatch specsmd_inferno_reviewer/);
  const scan = run(fixture, ["scan", "--tree", tree, "--config", CODEX]);
  assert.equal(scan.code, 3, scan.out + scan.err);
  assert.match(scan.out, /dispatch specsmd_inferno_scanner model model-codex-scan scan wiring/);
});

test("the intent review reads the collected scan and records once every line is answered", () => {
  const { fixture, tree } = started();
  const sent = JSON.parse(run(fixture, ["scan", "--tree", tree, "--json"]).out).groups.flat();
  for (const entry of sent) {
    const lines = entry.id === "wiring"
      ? '\n  - file: src/a.ts\n    line: 1\n    claim: a reads no producer\n    proof: "rg -n producer src"\n'
      : " []\n";
    write(path.dirname(entry.result), path.basename(entry.result), `question: ${entry.id}\nlines:${lines}`);
  }
  const collected = run(fixture, ["scan", "--collect", "--tree", tree]);
  assert.equal(collected.code, 0, collected.out + collected.err);
  const dispatch = run(fixture, ["review", "--tree", tree]);
  assert.equal(dispatch.code, 3, dispatch.out + dispatch.err);
  assert.match(dispatch.out, /dispatch specsmd-inferno-reviewer/);
  assert.match(dispatch.out, /scan \.specs-inferno\/intents\/alpha\/scan\.yaml/);
  write(tree, REVIEW, "verdict: clean\n");
  const open = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(open.code, 2, open.out + open.err);
  assert.match(open.err, /scan line wiring-1 has no answer/);
  write(tree, REVIEW, "verdict: clean\nscanner:\n  - id: wiring-1\n    answer: confirmed\n    reason: the producer is missing\n");
  const recorded = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
  assert.match(recorded.out, /intent review clean, recorded/);
});
