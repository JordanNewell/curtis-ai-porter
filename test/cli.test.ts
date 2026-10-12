// CLI end-to-end: the built dist/cli.mjs spawned against hostile argument
// shapes and unwritable output paths — dangling flag values, blocked write
// targets, a busy serve port. Skipped when dist/ hasn't been built; run
// `npm run build` first (npm test alone builds only the test bundles).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'dist', 'cli.mjs');

/** Minimal generic-JSON transcript the parsers accept. */
function transcript(title: string): string {
	return JSON.stringify({
		title,
		messages: [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'hello' },
		],
	});
}

function run(args: string[], cwd?: string): SpawnSyncReturns<string> {
	const opts: SpawnSyncOptionsWithStringEncoding = { encoding: 'utf8', cwd };
	return spawnSync(process.execPath, [CLI, ...args], opts);
}

function withTempDir(fn: (dir: string) => void): void {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'porter-cli-'));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function built(): boolean {
	return existsSync(CLI);
}

test('convert: dangling --format value prints usage and exits 2, no stack', (t) => {
	if (!built()) return t.skip('dist/cli.mjs not built');
	withTempDir((dir) => {
		const f = path.join(dir, 'chat.json');
		writeFileSync(f, transcript('Adjacency'));
		const r = run(['convert', '--format', '--zip', f]);
		assert.equal(r.status, 2);
		assert.ok(r.stdout.includes('Usage: curt-porter convert'), r.stdout);
		assert.ok(!r.stderr.includes('    at '), `stack trace leaked: ${r.stderr}`);
	});
});

test('convert: bad --format value exits 2 with the message, no stack', (t) => {
	if (!built()) return t.skip('dist/cli.mjs not built');
	withTempDir((dir) => {
		const f = path.join(dir, 'chat.json');
		writeFileSync(f, transcript('Formats'));
		const r = run(['convert', f, '--format', 'xml']);
		assert.equal(r.status, 2);
		assert.ok(r.stderr.includes('--format must be curt | md | both (got "xml")'), r.stderr);
		assert.ok(!r.stderr.includes('    at '), `stack trace leaked: ${r.stderr}`);
	});
});

test('convert: --out followed by a flag keeps the default output dir', (t) => {
	if (!built()) return t.skip('dist/cli.mjs not built');
	withTempDir((dir) => {
		const f = path.join(dir, 'chat.json');
		writeFileSync(f, transcript('Flag adjacency'));
		const r = run(['convert', f, '--out', '--zip'], dir);
		assert.equal(r.status, 0);
		// The zip lands in the default dir; nothing is named "--zip".
		assert.ok(existsSync(path.join(dir, 'curt-porter-out', 'curt-porter.zip')));
		assert.ok(!existsSync(path.join(dir, '--zip')), 'a literal "--zip" path was created');
		assert.ok(r.stdout.includes('(1 conversations)'), r.stdout);
	});
});

test('convert: one unwritable file fails alone, the rest still land (exit 0)', (t) => {
	if (!built()) return t.skip('dist/cli.mjs not built');
	withTempDir((dir) => {
		const good = path.join(dir, 'good.json');
		const bad = path.join(dir, 'bad.json');
		writeFileSync(good, transcript('Lisbon weekend'));
		writeFileSync(bad, transcript('Blockable'));
		const out = path.join(dir, 'out');
		mkdirSync(out);
		// A directory squatting where Blockable.curt must be written — the
		// .curt filename carries no id suffix, so the collision is exact.
		mkdirSync(path.join(out, 'Blockable.curt'));
		const r = run(['convert', good, bad, '--format', 'curt', '--out', out]);
		assert.equal(r.status, 0);
		assert.ok(r.stdout.includes('Wrote 1 file to'), r.stdout);
		assert.ok(r.stderr.includes('! Blockable.curt —'), r.stderr);
		assert.ok(existsSync(path.join(out, 'Lisbon weekend.curt')));
	});
});

test('convert: unwritable output dir reports the failure and exits 1', (t) => {
	if (!built()) return t.skip('dist/cli.mjs not built');
	withTempDir((dir) => {
		const blocker = path.join(dir, 'not-a-dir');
		writeFileSync(blocker, 'x');
		const f = path.join(dir, 'chat.json');
		writeFileSync(f, transcript('Solo'));
		const r = run(['convert', f, '--out', blocker]);
		assert.equal(r.status, 1);
		assert.ok(r.stderr.includes(`! ${blocker} —`), r.stderr);
		assert.ok(!r.stdout.includes('Wrote'), r.stdout);
	});
});

test('serve: busy port prints a friendly line and exits 1, no stack', async (t) => {
	if (!built()) return t.skip('dist/cli.mjs not built');
	const blocker = createServer(() => {});
	await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
	const port = (blocker.address() as AddressInfo).port;
	try {
		const r = run(['serve', '--port', String(port)]);
		assert.equal(r.status, 1);
		assert.ok(r.stderr.includes(`Port ${port} in use — try --port <other>`), r.stderr);
		assert.ok(!r.stderr.includes('    at '), `stack trace leaked: ${r.stderr}`);
	} finally {
		await new Promise<void>((resolve) => blocker.close(() => resolve()));
	}
});
