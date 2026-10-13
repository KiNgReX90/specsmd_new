const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

// The batch against real cargo, on a dependency-free crate of a few lines. The switches compile,
// the control is green, each switch flips at run time without a rebuild, an attribute entry takes
// its own build, and a mistake that does not compile reads no verdict instead of caught.

const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");
const { onPath } = require("./run-lib.cjs");

const RUN = path.join(__dirname, "run.cjs");
const CARGO = onPath("cargo");

const LIB = `pub fn add(a: u32, b: u32) -> u32 {
    a + b
}

pub fn total(xs: &[u32]) -> u32 {
    let mut sum = 0;
    for x in xs {
        sum += x;
    }
    sum
}

pub fn is_big(n: u32) -> bool {
    n >= 10
}

pub fn twice(n: u32) -> u32 {
    n * 2
}

pub fn check(n: u32) {
    if n > 9 {
        panic!("boom");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_works() {
        assert_eq!(add(2, 3), 5);
    }

    #[test]
    fn total_works() {
        assert_eq!(total(&[1, 2, 3]), 6);
    }

    #[test]
    fn is_big_works() {
        assert!(is_big(11));
        assert!(!is_big(3));
    }

    #[test]
    fn twice_works() {
        assert_eq!(twice(4), 8);
    }

    #[test]
    #[should_panic(expected = "boom")]
    fn check_panics() {
        check(10);
    }
}
`;

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("a real cargo batch shares its build across the switches and gives honest verdicts", { skip: CARGO ? false : "cargo is not on PATH" }, (t) => {
  const dir = tempDir("inferno-mutate-cargo-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "crate");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  writeFile(path.join(root, "Cargo.toml"), '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n');
  writeFile(path.join(root, ".gitignore"), "/target\nCargo.lock\n");
  writeFile(path.join(root, "src/lib.rs"), LIB);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "crate");

  const cargo = (name) => `cargo test --offline --lib ${name}`;
  const at = (marker) => LIB.split("\n").findIndex((line) => line.includes(marker)) + 1;
  const entry = (criterion, marker, find, replace, name) => ({ criterion, file: "src/lib.rs", line: at(marker), find, replace, test: cargo(name) });
  const entries = [
    entry("AC1", "a + b", "a + b", "a - b", "add_works"),
    entry("AC2", "sum += x;", "sum += x;", "", "total_works"),
    entry("AC3", "n >= 10", "n >= 10", "n > 10", "is_big_works"),
    entry("AC4", "n * 2", "n * 2", "n * \"2\"", "twice_works"),
    entry("AC5", "n > 9", "n > 9", "n > 10", "check_panics"),
    entry("AC6", "panic!(", "panic!(\"boom\");", "", "check_panics"),
    entry("AC7", "should_panic", "\"boom\"", "\"bang\"", "check_panics"),
  ];
  const batch = path.join(dir, "batch.json");
  writeFile(batch, JSON.stringify(entries));
  // CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker. This crate is dependency-free in its own target dir,
  // so its builds run as is and never wait behind another session's build on the machine-wide lock.
  const env = { ...process.env, CLAUDE_BUILD_WRAPPED: "1", XDG_CACHE_HOME: path.join(dir, "cache"), CARGO_TARGET_DIR: path.join(dir, "target") };
  const result = spawnSync(process.execPath, [RUN, "mutate", "--tree", root, "--batch", batch, "--json"],
    { cwd: root, encoding: "utf8", env, timeout: 540_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  const by = Object.fromEntries(payload.entries.map((entry) => [entry.criterion, entry]));

  assert.deepEqual(payload.entries.map((entry) => [entry.criterion, entry.form, entry.caught]), [
    ["AC1", "switch", true],
    ["AC2", "switch", true],
    ["AC3", "switch", false],
    ["AC4", "classic", null],
    ["AC5", "switch", true],
    ["AC6", "switch", true],
    ["AC7", "classic", true],
  ]);
  assert.equal(by.AC4.why, "did not build");
  assert.match(by.AC7.own, /attribute/);
  // Two control rounds (the first refused AC4's switch), then AC4 and AC7 on their own.
  assert.equal(payload.builds, 4);
  for (const name of ["AC1", "AC2", "AC3", "AC5", "AC6"]) {
    assert.doesNotMatch(fs.readFileSync(by[name].log, "utf8"), /^\s*Compiling fixture/m, `${name} rebuilt`);
  }
  assert.equal(fs.readFileSync(path.join(root, "src/lib.rs"), "utf8"), LIB);
  assert.equal(git(root, "status", "--porcelain"), "");
});
