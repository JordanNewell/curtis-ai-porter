// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// End-to-end smoke: the built dist/cli.mjs run as a real subprocess against
// the demo fixtures — every command's happy path, plus a convert → export
// round-trip and a live `serve` fetch. Complements cli.test.ts (hostile
// arguments); together they cover both sides of the CLI contract.
// Skipped when dist/ hasn't been built; `npm test` builds first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const CLI = path.join(root, 'dist', 'cli.mjs');
const FIXTURES = path.join(root, 'demo', 'fixtures');

function run(args: string[], cwd?: string): SpawnSyncReturns<string> {
	const opts: SpawnSyncOptionsWithStringEncoding = { encoding: 'utf8', cwd, timeout: 30_000 };
	return spawnSync(process.execPath, [CLI, ...args], opts);
}

function withTempDir(fn: (dir: string) => void): void {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'porter-smoke-'));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function built(): boolean {
	return existsSync(CLI) && existsSync(path.join(root, 'dist', 'porter.html'));
}

test('smoke: --help lists every command, --version matches the package', () => {
	if (!built()) return;
	const help = run(['--help']);
	assert.equal(help.status, 0);
	for (const cmd of ['convert', 'export', 'verify', 'stats', 'serve']) assert.ok(help.stdout.includes(cmd), `help mentions ${cmd}`);
	const version = run(['--version']);
	assert.equal(version.status, 0);
	const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
	assert.equal(version.stdout.trim(), pkg.version);
});

test('smoke: convert ChatGPT export zip writes .curt + .md and verify round-trips them', () => {
	if (!built()) return;
	withTempDir((dir) => {
		const out = path.join(dir, 'out');
		const r = run(['convert', path.join(FIXTURES, 'chatgpt-export.zip'), '--out', out]);
		assert.equal(r.status, 0, `convert failed: ${r.stderr}`);
		const files = readdirSync(out);
		assert.ok(files.some((f) => f.endsWith('.curt')), 'wrote at least one .curt');
		assert.ok(files.some((f) => f.endsWith('.md')), 'wrote at least one .md');
		const v = run(['verify', ...files.map((f) => path.join(out, f))]);
		assert.equal(v.status, 0, `verify failed: ${v.stderr}`);
		assert.ok(v.stdout.includes('round-trip'));
	});
});

test('smoke: convert Claude export JSON and DeepSeek paste', () => {
	if (!built()) return;
	withTempDir((dir) => {
		const claude = run(['convert', path.join(FIXTURES, 'claude-export.json'), '--out', path.join(dir, 'claude')]);
		assert.equal(claude.status, 0, `claude convert failed: ${claude.stderr}`);
		assert.ok(readdirSync(path.join(dir, 'claude')).length > 0);

		const deepseek = run(['convert', path.join(FIXTURES, 'deepseek-paste.md'), '--format', 'curt', '--out', path.join(dir, 'ds')]);
		assert.equal(deepseek.status, 0, `deepseek convert failed: ${deepseek.stderr}`);
		const dsFiles = readdirSync(path.join(dir, 'ds'));
		assert.ok(dsFiles.every((f) => f.endsWith('.curt')), '--format curt writes only .curt');
	});
});

test('smoke: convert Curtis zip bundle and single-file --zip output', () => {
	if (!built()) return;
	withTempDir((dir) => {
		const curt = run(['convert', path.join(FIXTURES, 'curtis-chats-demo.zip'), '--out', path.join(dir, 'curt')]);
		assert.equal(curt.status, 0, `curtis zip convert failed: ${curt.stderr}`);
		assert.ok(readdirSync(path.join(dir, 'curt')).length > 0);

		const zipped = run(['convert', path.join(FIXTURES, 'claude-export.json'), '--zip', '--out', dir]);
		assert.equal(zipped.status, 0);
		const zipPath = path.join(dir, 'curt-porter.zip');
		assert.ok(existsSync(zipPath), 'wrote curt-porter.zip');
		const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(zipPath))));
		assert.ok(entries.length > 0, 'zip has entries');
	});
});

test('smoke: audit-inbox conversion files parseable receipts', () => {
	if (!built()) return;
	withTempDir((dir) => {
		const inbox = path.join(dir, 'inbox.md');
		const r = run(['convert', path.join(FIXTURES, 'claude-export.json'), '--out', path.join(dir, 'out'), '--audit-inbox', inbox]);
		assert.equal(r.status, 0);
		assert.ok(r.stdout.includes('audit receipt'));
		assert.ok(statSync(inbox).size > 0, 'inbox has content');
	});
});

test('smoke: export to chatgpt-json, api-jsonl and continuation all produce parseable output', () => {
	if (!built()) return;
	withTempDir((dir) => {
		const zip = path.join(FIXTURES, 'chatgpt-export.zip');

		const gj = run(['export', zip, '--to', 'chatgpt-json', '--out', path.join(dir, 'gj')]);
		assert.equal(gj.status, 0, `chatgpt-json export failed: ${gj.stderr}`);
		const conversations = path.join(dir, 'gj', 'conversations.json');
		assert.ok(existsSync(conversations), 'conversations.json exists');
		JSON.parse(readFileSync(conversations, 'utf8'));

		const jl = run(['export', zip, '--to', 'api-jsonl', '--out', path.join(dir, 'jl')]);
		assert.equal(jl.status, 0, `api-jsonl export failed: ${jl.stderr}`);
		for (const f of readdirSync(path.join(dir, 'jl'))) {
			if (!f.endsWith('.jsonl')) continue;
			for (const line of readFileSync(path.join(dir, 'jl', f), 'utf8').split('\n')) {
				if (line.trim()) JSON.parse(line);
			}
		}

		const cont = run(['export', zip, '--to', 'continuation', '--target', 'chatgpt', '--out', path.join(dir, 'cont')]);
		assert.equal(cont.status, 0, `continuation export failed: ${cont.stderr}`);
		assert.ok(readdirSync(path.join(dir, 'cont')).some((f) => f.endsWith('.md')), 'continuation pack is markdown');
	});
});

test('smoke: round-trip — converted markdown re-converts back to .curt', () => {
	if (!built()) return;
	withTempDir((dir) => {
		const first = run(['convert', path.join(FIXTURES, 'chatgpt-export.zip'), '--format', 'md', '--out', path.join(dir, 'md')]);
		assert.equal(first.status, 0);
		const mdFiles = readdirSync(path.join(dir, 'md')).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, 'md', f));
		assert.ok(mdFiles.length > 0);
		const second = run(['convert', ...mdFiles, '--format', 'curt', '--out', path.join(dir, 'curt2')]);
		assert.equal(second.status, 0, `re-convert failed: ${second.stderr}`);
		assert.ok(readdirSync(path.join(dir, 'curt2')).some((f) => f.endsWith('.curt')));
	});
});

test('smoke: stats and stats --json both succeed on fixtures', () => {
	if (!built()) return;
	withTempDir((dir) => {
		const files = [path.join(FIXTURES, 'claude-export.json'), path.join(FIXTURES, 'deepseek-paste.md')];
		const text = run(['stats', ...files]);
		assert.equal(text.status, 0, `stats failed: ${text.stderr}`);
		assert.ok(text.stdout.length > 0);
		const json = run(['stats', ...files, '--json']);
		assert.equal(json.status, 0);
		const stats = JSON.parse(json.stdout);
		assert.ok(typeof stats === 'object');
	});
});

test('smoke: verify --json reports ok for native files and unknown for foreign ones', () => {
	if (!built()) return;
	withTempDir((dir) => {
		const r = run(['convert', path.join(FIXTURES, 'deepseek-paste.md'), '--format', 'curt', '--out', dir]);
		assert.equal(r.status, 0);
		const curtName = readdirSync(dir).find((f) => f.endsWith('.curt'));
		assert.ok(curtName, 'convert wrote a .curt file');
		const curtFile = path.join(dir, curtName);
		const v = run(['verify', curtFile, '--json']);
		assert.equal(v.status, 0);
		const results = JSON.parse(v.stdout);
		assert.ok(results.every((x: { result: { ok: boolean } }) => x.result.ok));
		const foreign = run(['verify', path.join(FIXTURES, 'claude-export.json')]);
		assert.equal(foreign.status, 1, 'foreign format fails verify');
	});
});

test('smoke: serve answers HTTP with the porter page', async () => {
	if (!built()) return;
	await new Promise<void>((resolve, reject) => {
		// Random high port — --port 0 would silently fall back to the 7777 default.
		const port = 30000 + Math.floor(Math.random() * 20000);
		const child = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
		const to = setTimeout(() => { child.kill(); reject(new Error('serve never came up')); }, 15_000);
		let buf = '';
		child.stdout.on('data', async (chunk: Buffer) => {
			buf += chunk.toString();
			const m = buf.match(/http:\/\/localhost:(\d+)/);
			if (!m) return;
			try {
				const res = await fetch(`http://127.0.0.1:${m[1]}/`);
				assert.equal(res.status, 200);
				const body = await res.text();
				assert.ok(body.includes('<script>'), 'page inlines the app bundle');
				assert.ok(!body.includes('<!--PORTER_APP_JS-->'), 'no build placeholder left behind');
				clearTimeout(to);
				resolve();
			} catch (e) {
				clearTimeout(to);
				reject(e as Error);
			} finally {
				child.kill();
			}
		});
		child.on('error', (e) => { clearTimeout(to); reject(e); });
	});
});
