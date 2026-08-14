import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ALLOWED_PREFIXES, findViolations, isAllowed } from './dash-lint.mjs';

// Built from escapes on purpose. This file is itself linted, and a literal
// would make the linter's own test the first thing it rejects.
const EM = '\u2014';
const EN = '\u2013';

const SCRIPT = fileURLToPath(new URL('dash-lint.mjs', import.meta.url));

function diff(file, addedLines, { startLine = 1 } = {}) {
	return [
		`diff --git a/${file} b/${file}`,
		'--- /dev/null',
		`+++ b/${file}`,
		`@@ -0,0 +${startLine},${addedLines.length} @@`,
		...addedLines.map((line) => `+${line}`),
		'',
	].join('\n');
}

test('an added line with an em dash is a violation', () => {
	const found = findViolations(diff('docs/PRODUCT.md', [`the dossier ${EM} complete`]));
	assert.equal(found.length, 1);
	assert.equal(found[0].file, 'docs/PRODUCT.md');
	assert.equal(found[0].line, 1);
	assert.equal(found[0].character, 'em dash');
});

test('an added line with an en dash is a violation', () => {
	const found = findViolations(diff('src/lib/copy.ts', [`pages 10${EN}12`]));
	assert.equal(found.length, 1);
	assert.equal(found[0].character, 'en dash');
});

test('added lines without either dash are clean', () => {
	const found = findViolations(diff('docs/PRODUCT.md', ['plain hyphen-joined words', 'a comma, then more']));
	assert.deepEqual(found, []);
});

test('line numbers come from the hunk header, not the diff position', () => {
	const found = findViolations(diff('docs/PRODUCT.md', ['clean', `dirty ${EM} here`], { startLine: 40 }));
	assert.equal(found.length, 1);
	assert.equal(found[0].line, 41);
});

test('removed and context lines are ignored, so legacy prose never blocks an edit', () => {
	const text = [
		'diff --git a/docs/PRODUCT.md b/docs/PRODUCT.md',
		'--- a/docs/PRODUCT.md',
		'+++ b/docs/PRODUCT.md',
		'@@ -1,3 +1,3 @@',
		` context ${EM} untouched`,
		`-removed ${EM} line`,
		'+added clean line',
		'',
	].join('\n');
	assert.deepEqual(findViolations(text), []);
});

test('the +++ header itself is never read as an added line', () => {
	const text = [
		`diff --git a/docs/a${EM}b.md b/docs/a${EM}b.md`,
		'--- /dev/null',
		`+++ b/docs/a${EM}b.md`,
		'@@ -0,0 +1,1 @@',
		'+clean content',
		'',
	].join('\n');
	assert.deepEqual(findViolations(text), []);
});

test('reproduced third-party text is allowlisted by path', () => {
	for (const prefix of ['THIRD-PARTY-NOTICES.md']) {
		assert.ok(ALLOWED_PREFIXES.includes(prefix), `${prefix} must stay allowlisted`);
		const found = findViolations(diff(prefix, [`Copyright ${EM} holders`]));
		assert.deepEqual(found, [], `${prefix} must not be linted`);
	}
});

test('an allowlisted path does not allow a same-named file somewhere else', () => {
	assert.equal(isAllowed('THIRD-PARTY-NOTICES.md'), true);
	assert.equal(isAllowed('docs/THIRD-PARTY-NOTICES.md'), false);
});

test('a deleted file has no added lines to lint', () => {
	const text = [
		'diff --git a/docs/gone.md b/docs/gone.md',
		'--- a/docs/gone.md',
		'+++ /dev/null',
		'@@ -1,1 +0,0 @@',
		`-old ${EM} text`,
		'',
	].join('\n');
	assert.deepEqual(findViolations(text), []);
});

test('every violation in one diff is reported, not just the first', () => {
	const found = findViolations(diff('docs/PRODUCT.md', [`one ${EM}`, 'clean', `two ${EN}`]));
	assert.deepEqual(
		found.map((v) => v.line),
		[1, 3],
	);
});

test('the linter fails a real staged commit and passes a clean one', (t) => {
	const repo = mkdtempSync(join(tmpdir(), 'dash-lint-'));
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

	git('init', '--quiet');
	git('config', 'user.email', 'test@example.invalid');
	git('config', 'user.name', 'dash lint test');

	writeFileSync(join(repo, 'clean.md'), 'a plain sentence, then another.\n');
	git('add', 'clean.md');
	const clean = execFileSync('node', [SCRIPT, '--staged'], { cwd: repo, encoding: 'utf8' });
	assert.match(clean, /no em dash or en dash/i);

	writeFileSync(join(repo, 'dirty.md'), `a sentence ${EM} with a dash.\n`);
	git('add', 'dirty.md');
	assert.throws(
		() => execFileSync('node', [SCRIPT, '--staged'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }),
		(error) => {
			assert.equal(error.status, 1);
			assert.match(error.stderr ?? '', /dirty\.md:1/);
			return true;
		},
	);

	// The same content under an allowlisted path is left alone.
	writeFileSync(join(repo, 'THIRD-PARTY-NOTICES.md'), `Copyright ${EM} holders.\n`);
	git('rm', '--quiet', '--cached', 'dirty.md');
	rmSync(join(repo, 'dirty.md'));
	git('add', 'THIRD-PARTY-NOTICES.md');
	const allowed = execFileSync('node', [SCRIPT, '--staged'], { cwd: repo, encoding: 'utf8' });
	assert.match(allowed, /no em dash or en dash/i);
});
