#!/usr/bin/env node
// Rejects the em dash and the en dash in repository prose.
//
// WHY DIFF BASED. The rule is about what we write, not about what is already
// here. Scanning the whole tree would make an unrelated one-line edit fail on
// legacy material somebody else wrote, so this reads ADDED lines only: staged
// ones before a commit, and the branch's own lines in CI. Legacy text is
// cleaned when it is next touched, never as a tax on the next contributor.
//
// WHY AN ALLOWLIST. The third-party notices reproduce other projects' licence
// text, which we are obliged to retain exactly as written. Editing punctuation
// inside a reproduced licence would break the term that requires it to be
// reproduced, so that path is excluded rather than fixed.
//
// This file writes both characters as escapes so it never trips itself.
//
// Usage:
//   node scripts/dash-lint.mjs               staged changes (default)
//   node scripts/dash-lint.mjs --staged      same, explicit
//   node scripts/dash-lint.mjs --since <ref> everything this branch adds on top
//                                            of its merge base with <ref> (CI)

import { execFileSync } from 'node:child_process';

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

const CHARACTERS = [
	{ code: EM_DASH, name: 'em dash' },
	{ code: EN_DASH, name: 'en dash' },
];

// Directory prefixes only. A prefix must end with `/` so that `research/` never
// silently covers a sibling like `research-notes/`.
export const ALLOWED_PREFIXES = [
	'THIRD-PARTY-NOTICES.md',
];

export function isAllowed(path, prefixes = ALLOWED_PREFIXES) {
	return prefixes.some((prefix) => path.startsWith(prefix));
}

export function findViolations(diff, { prefixes = ALLOWED_PREFIXES } = {}) {
	const violations = [];
	let file = null;
	let lineNumber = 0;

	for (const raw of diff.split('\n')) {
		if (raw.startsWith('+++ ')) {
			const target = raw.slice(4).trim();
			// `/dev/null` is a deletion: it has no added lines to judge.
			file = target === '/dev/null' ? null : target.replace(/^b\//, '');
			continue;
		}
		if (raw.startsWith('--- ') || raw.startsWith('diff --git ')) continue;

		if (raw.startsWith('@@')) {
			const match = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
			lineNumber = match ? Number(match[1]) : 0;
			continue;
		}

		if (!raw.startsWith('+')) continue;
		const text = raw.slice(1);
		const current = lineNumber;
		lineNumber += 1;
		if (!file || isAllowed(file, prefixes)) continue;

		for (const { code, name } of CHARACTERS) {
			if (text.includes(code)) violations.push({ file, line: current, character: name, text });
		}
	}

	return violations;
}

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function stagedDiff() {
	return git(['diff', '--cached', '--no-color', '--diff-filter=ACMR', '-U0']);
}

function branchDiff(ref) {
	const base = git(['merge-base', 'HEAD', ref]).trim();
	return git(['diff', '--no-color', '--diff-filter=ACMR', '-U0', base, 'HEAD']);
}

function main(argv) {
	const mode = argv[0] ?? '--staged';
	let diff;

	if (mode === '--staged') {
		diff = stagedDiff();
	} else if (mode === '--since') {
		const ref = argv[1];
		if (!ref) {
			process.stderr.write('dash-lint: --since needs a ref, for example --since origin/main\n');
			return 2;
		}
		diff = branchDiff(ref);
	} else {
		process.stderr.write(`dash-lint: unknown mode ${mode}. Use --staged or --since <ref>.\n`);
		return 2;
	}

	const violations = findViolations(diff);
	if (violations.length === 0) {
		process.stdout.write('dash-lint: no em dash or en dash in added lines.\n');
		return 0;
	}

	const report = violations
		.map((v) => `  ${v.file}:${v.line}  [${v.character}]\n      ${v.text.trim().slice(0, 100)}`)
		.join('\n');

	process.stderr.write(
		`\nBLOCKED: em dash or en dash in added prose.\n\n${report}\n\n` +
			'  Use a period or a comma instead. Two short sentences beat one long one.\n' +
			'  Reproduced third-party text is excluded by path\n' +
			`  (${ALLOWED_PREFIXES.join(', ')}). Never reword text we are obliged to\n` +
			'  reproduce verbatim to satisfy this check.\n\n',
	);
	return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main(process.argv.slice(2)));
}
