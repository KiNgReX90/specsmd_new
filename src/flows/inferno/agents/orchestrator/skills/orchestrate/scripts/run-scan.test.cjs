const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");
const proofs = require("./run-proofs.cjs");
const { writeFile } = require("./test-write.cjs");

// The scan: four scanners each answer one question over the intent's whole diff before the
// intent review, because some leaks live between items and pass every item review.

const CLAUDE_ROLE = ".claude/agents/specsmd-inferno-scanner.md";
const CODEX_ROLE = ".codex/agents/specsmd_inferno_scanner.toml";
const CODEX = ".specs-inferno/config.codex.yaml";
const SCAN = ".specs-inferno/intents/alpha/scan.yaml";
const IDS = ["wiring", "contract", "reread", "live-path"];
const INSTALLED = { [CLAUDE_ROLE]: "---\nname: specsmd-inferno-scanner\n---\n", [CODEX_ROLE]: 'name = "specsmd_inferno_scanner"\n' };

function started(options = {}) {
  const fixture = repo({ ...options, files: { ...INSTALLED, ...(options.files || {}) } });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  return { fixture, tree };
}

const scan = (fixture, tree, args = []) => run(fixture, ["scan", "--tree", tree, ...args]);
const head = (tree) => git(tree, ["rev-parse", "HEAD"]);

/** The result path of every dispatched scanner, from the scan's own payload. */
function dispatched(fixture, tree, args = []) {
  const result = scan(fixture, tree, [...args, "--json"]);
  assert.equal(result.code, 3, result.out + result.err);
  return Object.fromEntries(JSON.parse(result.out).groups.flat().map((entry) => [entry.id, entry]));
}

const LINE = '  - file: src/a.ts\n    line: 1\n    claim: a reads no producer\n    proof: "rg -n producer src"\n';
/** A plan-time line also carries its kind; a MAKER line blocks the plan. */
const PLAN_LINE = LINE.replace("    claim:", "    kind: MAKER\n    claim:");
function answer(entry, lines = "") {
  write(path.dirname(entry.result), path.basename(entry.result), `question: ${entry.id}\nlines:${lines ? `\n${lines}` : " []\n"}`);
}

test("scan writes four briefs, each with the range, one question and its result path, and prints four dispatch lines in one group", () => {
  const { fixture, tree } = started({ config: `${CONFIG}scan:\n  model: model-scan\n` });
  const range = `${git(tree, ["merge-base", "HEAD", "main"]).slice(0, 7)}..${head(tree).slice(0, 7)}`;
  const result = scan(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /spawn these 4 in one message/);
  const markers = { wiring: /no producer/, contract: /real producer/, reread: /re-read/, "live-path": /fault-seam/ };
  for (const id of IDS) {
    const line = new RegExp(`dispatch specsmd-inferno-scanner model model-scan scan ${id} brief (\\S+)`).exec(result.out);
    assert.ok(line, `${id}: ${result.out}`);
    const brief = fs.readFileSync(line[1], "utf8");
    assert.match(brief, new RegExp(`range ${range}`));
    assert.match(brief, markers[id]);
    for (const other of IDS.filter((entry) => entry !== id)) assert.doesNotMatch(brief, markers[other]);
    assert.match(brief, new RegExp(`result ${line[1].replace(/\.md$/, ".yaml").replace(/[.]/g, "\\.")}`));
  }
  assert.match(result.out, /run\.cjs scan --collect/);
});

test("on Codex the scan prints three dispatch lines to spawn together, then the fourth", () => {
  const { fixture, tree } = started({ files: { [CODEX]: "roles:\n  scanner:\n    model: model-codex-scan\n" } });
  const result = scan(fixture, tree, ["--config", CODEX]);
  assert.equal(result.code, 3, result.out + result.err);
  const lines = result.out.split("\n");
  const at = (pattern) => lines.findIndex((line) => pattern.test(line));
  assert.ok(at(/spawn these 3 in one message/) >= 0, result.out);
  for (const id of IDS) assert.ok(at(new RegExp(`dispatch specsmd_inferno_scanner model model-codex-scan scan ${id} brief`)) >= 0, id);
  const second = at(/once they return, spawn this one/);
  assert.ok(second > at(/scan reread brief/), result.out);
  assert.ok(at(/scan live-path brief/) > second, result.out);
  assert.match(result.out, new RegExp(`scan --collect --tree ${tree} --config ${CODEX.replace(/[.]/g, "\\.")}`));
});

test("the scanner's model is scan.model first on Claude, then its role entry; on Codex a role with no model leaves the agent's own pin", () => {
  const role = "roles:\n  scanner:\n    model: model-role\n";
  const pinned = started({ config: `${CONFIG}${role}scan:\n  model: model-scan\n` });
  assert.match(scan(pinned.fixture, pinned.tree).out, /dispatch specsmd-inferno-scanner model model-scan scan wiring/);
  const byRole = started({ config: `${CONFIG}${role}` });
  assert.match(scan(byRole.fixture, byRole.tree).out, /dispatch specsmd-inferno-scanner model model-role scan wiring/);
  const codex = started({ files: { [CODEX]: "roles:\n  scanner:\n    effort: high\n" } });
  assert.match(scan(codex.fixture, codex.tree, ["--config", CODEX]).out, /dispatch specsmd_inferno_scanner scan wiring brief/);
});

test("collect exits 3 while a result is missing and names the scanner it waits on", () => {
  const { fixture, tree } = started();
  const sent = dispatched(fixture, tree);
  for (const id of ["wiring", "contract", "reread"]) answer(sent[id]);
  const result = scan(fixture, tree, ["--collect"]);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /live-path/);
  assert.doesNotMatch(result.out, /waiting on .*wiring/);
  assert.equal(fs.existsSync(path.join(tree, SCAN)), false);
});

test("collect exits 2 on a line without the command that proves it, and records nothing", () => {
  const { fixture, tree } = started();
  const sent = dispatched(fixture, tree);
  for (const id of IDS) answer(sent[id]);
  answer(sent.contract, "  - file: src/a.ts\n    line: 1\n    claim: a double fakes the store\n");
  const before = head(tree);
  const result = scan(fixture, tree, ["--collect"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /contract/);
  assert.match(result.err, /proof/);
  assert.match(result.err, /run\.cjs scan --collect/);
  assert.equal(head(tree), before);
  assert.equal(fs.existsSync(path.join(tree, SCAN)), false);
});

test("collect writes scan.yaml bound to the tree it read and commits that file alone", () => {
  const { fixture, tree } = started();
  const sent = dispatched(fixture, tree);
  for (const id of IDS) answer(sent[id]);
  answer(sent.wiring, LINE);
  const before = head(tree);
  const result = scan(fixture, tree, ["--collect"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /1 line/);
  assert.match(result.out, /run\.cjs review --tree/);
  assert.deepEqual(git(tree, ["show", "--name-only", "--format=", "HEAD"]).split("\n"), [SCAN]);
  const recorded = fs.readFileSync(path.join(tree, SCAN), "utf8");
  assert.match(recorded, new RegExp(`^tree: ${proofs.scopeHash(tree)}$`, "m"));
  assert.match(recorded, new RegExp(`^commit: ${before}$`, "m"));
  const { parseYaml } = require("./run-yaml.cjs");
  assert.deepEqual(parseYaml(recorded).lines, [
    { id: "wiring-1", scanner: "wiring", file: "src/a.ts", line: "1", claim: "a reads no producer", proof: "rg -n producer src" },
  ]);
  assert.equal(git(tree, ["status", "--porcelain"]), "");
  const again = scan(fixture, tree);
  assert.equal(again.code, 0, again.out + again.err);
  assert.match(again.out, /collected/);
});

test("a commit landing between the scan dispatch and the collect is not recorded as scanned", () => {
  const { fixture, tree } = started();
  const sent = dispatched(fixture, tree);
  for (const id of IDS) answer(sent[id]);
  write(tree, "src/a.ts", "export const a = 5;\n");
  git(tree, ["commit", "-qam", "landed after the scan"]);
  const result = scan(fixture, tree, ["--collect"]);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /moved since the scan dispatch/);
  assert.match(result.out, new RegExp(`run\\.cjs scan --tree ${tree}`));
  assert.equal(fs.existsSync(path.join(tree, SCAN)), false);
});

test("the plan-time scan asks the wiring question of the plan alone and hands every gap back to the planner", () => {
  const { fixture } = started();
  const plan = ["--only", "wiring", "--plan", "alpha"];
  const result = scan(fixture, fixture.root, plan);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /spawn this one/);
  const line = /dispatch specsmd-inferno-scanner scan wiring brief (\S+)/.exec(result.out);
  assert.ok(line, result.out);
  assert.doesNotMatch(result.out, /scan contract/);
  const brief = fs.readFileSync(line[1], "utf8");
  assert.match(brief, /plan \.specs-inferno\/intents\/alpha/);
  assert.doesNotMatch(brief, /range /);
  const entry = { id: "wiring", result: line[1].replace(/\.md$/, ".yaml") };
  answer(entry, PLAN_LINE);
  const gaps = scan(fixture, fixture.root, ["--collect", ...plan]);
  assert.equal(gaps.code, 2, gaps.out + gaps.err);
  assert.match(gaps.out, /GAP wiring-1 MAKER src\/a\.ts:1: a reads no producer/);
  assert.match(gaps.out, /planner/);
  assert.equal(fs.existsSync(path.join(fixture.root, SCAN)), false);
  answer(entry);
  const clear = scan(fixture, fixture.root, ["--collect", ...plan]);
  assert.equal(clear.code, 0, clear.out + clear.err);
});

test("the plan-time scan asks wiring alone, and its printed collect reads exactly what it sent", () => {
  const { fixture } = started();
  const result = scan(fixture, fixture.root, ["--plan", "alpha"]);
  assert.equal(result.code, 3, result.out + result.err);
  const sent = [...result.out.matchAll(/ scan (\S+) brief (\S+)/g)];
  assert.deepEqual(sent.map((line) => line[1]), ["wiring"]);
  const collect = /then (run\.cjs scan --collect .*) collects them/.exec(result.out)[1].split(" ").slice(1);
  answer({ id: "wiring", result: sent[0][2].replace(/\.md$/, ".yaml") }, PLAN_LINE);
  const gaps = run(fixture, collect);
  assert.equal(gaps.code, 2, gaps.out + gaps.err);
  assert.match(gaps.out, /GAP wiring-1/);
});

test("--only goes with --plan and names wiring alone, and the refusal prints the call that works", () => {
  const { fixture, tree } = started();
  const alone = scan(fixture, tree, ["--only", "wiring"]);
  assert.equal(alone.code, 1, alone.out + alone.err);
  assert.match(alone.err, /--plan/);
  for (const id of ["contract", "wires"]) {
    const refused = scan(fixture, fixture.root, ["--only", id, "--plan", "alpha"]);
    assert.equal(refused.code, 1, refused.out + refused.err);
    assert.match(refused.err, new RegExp(`the plan-time scan asks wiring alone: run run\\.cjs scan --only wiring --plan alpha --tree ${fixture.root}$`, "m"));
  }
});

test("collect refuses results of a dispatch that asked other questions than the call collects", () => {
  const { fixture } = started();
  const result = scan(fixture, fixture.root, ["--plan", "alpha", "--json"]);
  const [entry] = JSON.parse(result.out).groups.flat();
  const record = path.join(path.dirname(entry.result), "dispatch.json");
  const sent = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.deepEqual(sent.ids, ["wiring"]);
  writeFile(record, JSON.stringify({ ...sent, ids: ["wiring", "contract"] }));
  answer(entry);
  const refused = scan(fixture, fixture.root, ["--collect", "--plan", "alpha"]);
  assert.equal(refused.code, 3, refused.out + refused.err);
  assert.match(refused.out, /asked wiring, contract/);
  assert.match(refused.out, /run\.cjs scan --only wiring --plan alpha --tree \S+ for a fresh dispatch/);
});

test("a role installed in the primary checkout alone lets a worktree cut before it scan", () => {
  const fixture = repo();
  write(fixture.root, CLAUDE_ROLE, INSTALLED[CLAUDE_ROLE]);
  const tree = worktree(fixture, INTENT_TREE);
  assert.equal(fs.existsSync(path.join(tree, CLAUDE_ROLE)), false);
  const result = scan(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.equal([...result.out.matchAll(/^dispatch specsmd-inferno-scanner /gm)].length, 4);
});

test("a fresh dispatch after the tree moved drops the old results, so collect waits on all four again", () => {
  const { fixture, tree } = started();
  const sent = dispatched(fixture, tree);
  for (const id of IDS) answer(sent[id]);
  write(tree, "src/a.ts", "export const a = 6;\n");
  git(tree, ["commit", "-qam", "landed after the scan"]);
  assert.match(scan(fixture, tree, ["--collect"]).out, /moved since the scan dispatch/);
  dispatched(fixture, tree);
  const waiting = scan(fixture, tree, ["--collect"]);
  assert.equal(waiting.code, 3, waiting.out + waiting.err);
  assert.match(waiting.out, /waiting on the wiring, contract, reread, live-path scanners/);
});

test("a result that answers another question than its scanner was sent is refused", () => {
  const { fixture, tree } = started();
  const sent = dispatched(fixture, tree);
  for (const id of IDS) answer(sent[id]);
  write(path.dirname(sent.wiring.result), path.basename(sent.wiring.result), "question: contract\nlines: []\n");
  const result = scan(fixture, tree, ["--collect"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /question must be wiring/);
  assert.match(result.err, /the wiring scanner, then run run\.cjs scan --collect --tree/);
});

test("an install without the scanner role is refused with the fix, never skipped", () => {
  for (const [config, missing] of [[[], CLAUDE_ROLE], [["--config", CODEX], CODEX_ROLE]]) {
    const fixture = repo({ files: { [CODEX]: "host: codex\n" } });
    const tree = worktree(fixture, INTENT_TREE);
    const result = scan(fixture, tree, config);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, new RegExp(missing.replace(/[.]/g, "\\.")));
    assert.match(result.err, /reinstall the flow/);
    assert.match(result.err, /run\.cjs scan --tree/);
  }
});
