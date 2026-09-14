const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const owner = require("./run-owner.cjs");

const LINUX = process.platform === "linux" && fs.existsSync("/proc/self/stat");

/** A throwaway repo on a branch, because the record is keyed by the tree's branch. */
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-owner-"));
  const root = path.join(dir, "app");
  fs.mkdirSync(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "inferno-intent/x-20260910T000000Z");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return { root, cache: path.join(dir, "cache") };
}

function withCache(fixture, body) {
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = fixture.cache;
  try {
    return body();
  } finally {
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  }
}

test("a process's start tick is read from /proc, and a pid nobody has is null", { skip: !LINUX }, () => {
  assert.equal(typeof owner.processStart(process.pid), "number");
  assert.equal(owner.processStart(2 ** 22 - 1), null);
});

test("the session is a claude or codex ancestor, or nothing at all, never a guess", { skip: !LINUX }, () => {
  const found = owner.sessionProcess();
  if (found === null) return;
  const program = path.basename(fs.readFileSync(`/proc/${found.pid}/cmdline`, "utf8").split("\0")[0]);
  assert.ok(["claude", "codex"].includes(program), `session ${found.pid} runs ${program}`);
  assert.equal(found.start, owner.processStart(found.pid));
});

test("a recorded owner is read back beside the branch's gate job, and is alive while its process is", { skip: !LINUX }, () => {
  const fixture = tree();
  withCache(fixture, () => {
    const session = { pid: process.pid, start: owner.processStart(process.pid) };
    const record = owner.recordOwner(fixture.root, "frontier", session);
    assert.equal(record.pid, process.pid);
    assert.ok(owner.ownerFile(fixture.root).endsWith("/inferno-intent/x-20260910T000000Z/owner.json"));
    assert.deepEqual(owner.readOwner(fixture.root), record);
    assert.equal(owner.ownerAlive(record), true);
    assert.equal(owner.ownership(fixture.root).kind, "session");
  });
});

test("an owner whose pid is gone, or whose pid was recycled, is not alive", { skip: !LINUX }, () => {
  assert.equal(owner.ownerAlive({ pid: 2 ** 22 - 1, start: 1 }), false);
  assert.equal(owner.ownerAlive({ pid: process.pid, start: owner.processStart(process.pid) + 1 }), false);
  assert.equal(owner.ownerAlive(null), false);
});

test("no session means no record, so a hand-run step never stamps a wrong owner", () => {
  const fixture = tree();
  withCache(fixture, () => {
    assert.equal(owner.recordOwner(fixture.root, "gate", null), null);
    assert.equal(owner.readOwner(fixture.root), null);
    assert.equal(owner.ownership(fixture.root), null);
  });
});

test("a live gate job is ownership too, and a finished one is not", { skip: !LINUX }, async () => {
  const fixture = tree();
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)", "run.cjs"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    withCache(fixture, () => {
      const jobFile = path.join(fixture.cache, "specsmd-inferno", "app", "inferno-intent/x-20260910T000000Z", "gate-job.json");
      fs.mkdirSync(path.dirname(jobFile), { recursive: true });
      fs.writeFileSync(jobFile, JSON.stringify({ pid: child.pid, started: "2026-09-10T12:47:11Z" }));
      assert.equal(owner.gateJobAlive(fixture.root).pid, child.pid);
      assert.equal(owner.ownership(fixture.root).kind, "gate");
    });
  } finally {
    child.kill("SIGKILL");
  }
  await new Promise((resolve) => child.on("exit", resolve));
  withCache(fixture, () => {
    assert.equal(owner.gateJobAlive(fixture.root), null);
    assert.equal(owner.ownership(fixture.root), null);
  });
});
