const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const { INTENT_TREE, asPrinted, asPrintedByPath, git, printed, repo, run, worktree, write } = require("./review-fixture.cjs");

// Every scan, collect and review call the scan path prints carries the caller's tree, intent
// and host config. Run as printed on Codex, each call stays on Codex: a scan dispatches the
// Codex scanner, a collect hands on with the same flags, and a review dispatches the Codex
// reviewer. Each call runs from the project root, the way the orchestrator runs it.

const CODEX = ".specs-inferno/config.codex.yaml";
const CODEX_ROLE = ".codex/agents/specsmd_inferno_scanner.toml";
const HOST = {
  ".claude/agents/specsmd-inferno-scanner.md": "---\nname: specsmd-inferno-scanner\n---\n",
  [CODEX_ROLE]: 'name = "specsmd_inferno_scanner"\n',
  [CODEX]: "roles:\n  scanner:\n    model: model-codex-scan\nverification:\n  finalize:\n    - echo codex-gated\n" +
    "delivery:\n  base_branch: main\n",
};
const LINE = '\n  - file: src/a.ts\n    line: 1\n    claim: a reads no producer\n    proof: "rg -n producer src"\n';
const PLAN_LINE = LINE.replace("    claim:", "    kind: LEGAL\n    claim:");

/** A worktree with one commit of work, on a host with a Codex config and the given role files. */
function started(name = INTENT_TREE, files = HOST) {
  const fixture = repo({ files });
  const tree = worktree(fixture, name);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  return { fixture, tree };
}

/** The call dispatched the Codex scanner for every question; returns each result path by id. */
function scanned(result, count = 4) {
  const shown = `${(result.argv || []).join(" ")}\n${result.out}${result.err}`;
  assert.equal(result.code, 3, shown);
  const lines = [...result.out.matchAll(/^dispatch (\S+) model (\S+) scan (\S+) brief (\S+)$/gm)];
  assert.deepEqual(lines.map((line) => `${line[1]} ${line[2]}`), Array(count).fill("specsmd_inferno_scanner model-codex-scan"), shown);
  return Object.fromEntries(lines.map((line) => [line[3], line[4].replace(/\.md$/, ".yaml")]));
}

/** The call dispatched the Codex reviewer for the intent. */
function reviewed(result) {
  const shown = `${(result.argv || []).join(" ")}\n${result.out}${result.err}`;
  assert.equal(result.code, 3, shown);
  assert.match(result.out, /^dispatch specsmd_inferno_reviewer intent alpha$/m, shown);
}

function answer(results, lines = {}) {
  for (const [id, file] of Object.entries(results)) {
    write(path.dirname(file), path.basename(file), `question: ${id}\nlines:${lines[id] === undefined ? " []\n" : lines[id]}`);
  }
}

test("on Codex the plan-time refusal prints the caller's call with wiring, and run as printed it scans on Codex", () => {
  const fixture = repo({ files: HOST });
  const plan = ["--only", "contract", "--plan", "alpha", "--config", CODEX];
  const refused = run(fixture, ["scan", ...plan]);
  assert.equal(refused.code, 1, refused.out + refused.err);
  const [sent] = asPrinted(fixture, refused.err, "scan");
  scanned(sent, 1);
  const collecting = run(fixture, ["scan", "--collect", ...plan]);
  assert.equal(collecting.code, 1, collecting.out + collecting.err);
  const [collect] = asPrinted(fixture, collecting.err, "collect");
  assert.equal(collect.code, 3, collect.out + collect.err);
  scanned(asPrinted(fixture, collect.out, "scan")[0], 1);
});

test("on Codex gate and green owe the scan with its calls, and run as printed they scan, collect and review on Codex", () => {
  for (const step of ["gate", "green"]) {
    const { fixture, tree } = started();
    const owing = run(fixture, [step, "--tree", tree, "--config", CODEX]);
    assert.equal(owing.code, 3, owing.out + owing.err);
    assert.match(owing.out, /the scan is owed/);
    assert.doesNotMatch(owing.out, /PASS/);
    const results = scanned(asPrinted(fixture, owing.out, "scan")[0]);
    answer(results, { wiring: LINE });
    const [collected] = asPrinted(fixture, owing.out, "collect");
    assert.equal(collected.code, 0, collected.out + collected.err);
    reviewed(asPrinted(fixture, collected.out, "review")[0]);
  }
});

test("on a tree on no intent branch, every scan, collect and review call the scan prints on Codex runs on Codex", () => {
  const { [CODEX_ROLE]: role, ...uninstalled } = HOST;
  const { fixture, tree } = started("plain", uninstalled);
  const caller = ["--tree", tree, "--intent", "alpha", "--config", CODEX];
  const refused = run(fixture, ["scan", ...caller]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  write(fixture.root, CODEX_ROLE, role);
  const [first] = asPrinted(fixture, refused.err, "scan");
  scanned(first);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "landed after the scan"]);
  const moved = run(fixture, ["scan", "--collect", ...caller]);
  assert.match(moved.out, /moved since the scan dispatch/);
  scanned(asPrinted(fixture, moved.out, "scan")[0]);
  const owing = run(fixture, ["review", ...caller]);
  assert.equal(owing.code, 3, owing.out + owing.err);
  scanned(asPrinted(fixture, owing.out, "scan")[0]);
  const [waiting] = asPrinted(fixture, owing.out, "collect");
  assert.match(waiting.out, /waiting on the wiring, contract, reread, live-path scanners/);
  const results = scanned(asPrinted(fixture, waiting.out, "scan")[0]);
  answer(results, { contract: "\n  - file: src/a.ts\n    line: 1\n    claim: a double fakes the store\n" });
  const [bad] = asPrinted(fixture, waiting.out, "collect");
  assert.equal(bad.code, 2, bad.out + bad.err);
  answer(results, { wiring: LINE });
  const [recorded] = asPrinted(fixture, bad.err, "collect");
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
  reviewed(asPrinted(fixture, recorded.out, "review")[0]);
  reviewed(asPrinted(fixture, owing.out, "review")[0]);
  const [collected] = asPrinted(fixture, refused.err, "scan");
  assert.match(collected.out, /is collected in/);
  reviewed(asPrinted(fixture, collected.out, "review")[0]);
});

test("on Codex the plan-time scan's collect and its hand-off to the planner run as printed on Codex", () => {
  const fixture = repo({ files: HOST });
  const sent = run(fixture, ["scan", "--only", "wiring", "--plan", "alpha", "--config", CODEX]);
  answer(scanned(sent, 1), { wiring: PLAN_LINE });
  const [gaps] = asPrinted(fixture, sent.out, "collect");
  assert.equal(gaps.code, 2, gaps.out + gaps.err);
  assert.match(gaps.out, /GAP wiring-1/);
  scanned(asPrinted(fixture, gaps.out, "scan")[0], 1);
});

/** The scan collected with no line and the intent review dispatched, on the caller's flags. */
function scannedAndDispatched(fixture, caller) {
  answer(scanned(run(fixture, ["scan", ...caller])));
  assert.equal(run(fixture, ["scan", "--collect", ...caller]).code, 0);
  reviewed(run(fixture, ["review", ...caller]));
}

test("on Codex the intent review's verdicts print the item review and the gate, and run as printed they stay on Codex", () => {
  const review = ".specs-inferno/intents/alpha/review.yaml";
  const finding = 'findings:\n  - criterion: c\n    file: src/a.ts\n    line: "1"\n    evidence: e\n    fix: f\n    severity: minor\n    owner: a-one\n';
  const fixing = started();
  const caller = ["--tree", fixing.tree, "--config", CODEX];
  scannedAndDispatched(fixing.fixture, caller);
  write(fixing.tree, review, `verdict: fix\n${finding}`);
  const fix = run(fixing.fixture, ["review", ...caller, "--reviewer", "rev-1"]);
  assert.equal(fix.code, 2, fix.out + fix.err);
  const [item] = printed(fix.out, "review --item");
  assert.ok(item, fix.out);
  const itemReview = run(fixing.fixture, item.map((arg) => (arg === "<id>" ? "a-one" : arg)));
  assert.equal(itemReview.code, 3, itemReview.out + itemReview.err);
  assert.match(itemReview.out, /^dispatch specsmd_inferno_reviewer item a-one$/m, itemReview.out);
  const clean = started();
  const cleanCaller = ["--tree", clean.tree, "--config", CODEX];
  scannedAndDispatched(clean.fixture, cleanCaller);
  write(clean.tree, review, "verdict: clean\n");
  const passed = run(clean.fixture, ["review", ...cleanCaller, "--reviewer", "rev-1"]);
  assert.equal(passed.code, 0, passed.out + passed.err);
  const [gating] = asPrinted(clean.fixture, passed.out, "gate");
  assert.equal(gating.code, 0, gating.out + gating.err);
  const waited = asPrintedByPath(clean.fixture, gating.out);
  assert.equal(waited.code, 0, waited.out + waited.err);
  assert.match(waited.out, /PASS \d+s echo codex-gated/);
});
