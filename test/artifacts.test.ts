// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Release-consistency artifacts: the version triad, the license story, the
// SPDX header wall, and (when built) the shape of the shipped bundles. These
// are the checks the relicensing pass could have shipped wrong — the Obsidian
// plugin browser, versions.json and the landing page each say what they think
// the license and version are, and this suite makes them agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const versions = JSON.parse(readFileSync(path.join(root, 'versions.json'), 'utf8'));

test('artifacts: version triad — package.json, manifest.json, PORTER_VERSION, versions.json', () => {
	const versionTs = readFileSync(path.join(root, 'src', 'version.ts'), 'utf8');
	const porter = versionTs.match(/PORTER_VERSION = '([^']+)'/)?.[1];
	assert.ok(porter, 'src/version.ts exports PORTER_VERSION');
	assert.equal(pkg.version, porter, 'package.json matches PORTER_VERSION');
	assert.equal(manifest.version, porter, 'manifest.json matches PORTER_VERSION');
	assert.ok(versions[porter], `versions.json has a ${porter} entry`);
	// Obsidian resolves updates through versions.json: a shipped version must
	// declare the same minAppVersion the manifest ships with.
	assert.equal(versions[porter], manifest.minAppVersion, 'versions.json minAppVersion matches manifest');
});

test('artifacts: manifest description states the license correctly', () => {
	// The description is what the Obsidian community-plugin browser shows every
	// user — it must not carry the pre-relicense "free, MIT" claim.
	assert.doesNotMatch(manifest.description, /\bMIT\b/i, 'description no longer claims MIT');
});

test('artifacts: license story agrees everywhere', () => {
	assert.equal(pkg.license, 'BUSL-1.1');
	const license = readFileSync(path.join(root, 'LICENSE'), 'utf8');
	assert.ok(license.includes('Business Source License 1.1'), 'LICENSE is BUSL-1.1');
	const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
	// The Change Date must match what the README promises (MIT conversion).
	assert.ok(license.includes('2030-10-12'), 'LICENSE pins the 2030-10-12 Change Date');
	assert.ok(readme.includes('2030-10-12'), 'README names the 2030-10-12 MIT conversion date');
});

test('artifacts: every source file carries the SPDX header', () => {
	// Vendored curtis-reference snapshots are excluded — they're copies of the
	// plugin repo's code and carry that repo's licensing.
	const dirs = ['src', 'cli', 'test'];
	const missing: string[] = [];
	const walk = (dir: string): void => {
		for (const f of readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, f.name);
			if (f.isDirectory()) walk(p);
			else if (f.name.endsWith('.ts') && !readFileSync(p, 'utf8').includes('SPDX-License-Identifier: BUSL-1.1')) missing.push(path.relative(root, p));
		}
	};
	for (const d of dirs) walk(path.join(root, d));
	// The vendored reference snapshot is a copy of another repo's code — its
	// headers belong to that repo, not this one.
	const relevant = missing.filter((f) => !f.includes('curtis-reference'));
	assert.deepEqual(relevant, [], `files missing SPDX header: ${relevant.join(', ')}`);
});

test('artifacts: built CLI bundle keeps its shebang and skips the license banner', () => {
	const cli = path.join(root, 'dist', 'cli.mjs');
	if (!existsSync(cli)) return;
	const head = readFileSync(cli, 'utf8').slice(0, 64);
	assert.ok(head.startsWith('#!'), 'dist/cli.mjs starts with the shebang');
	assert.ok(!head.startsWith('//'), 'no banner before the shebang');
});

test('artifacts: built web page inlines the app, no placeholder remains', () => {
	const page = path.join(root, 'dist', 'porter.html');
	if (!existsSync(page)) return;
	const html = readFileSync(page, 'utf8');
	assert.ok(!html.includes('<!--PORTER_APP_JS-->'), 'build placeholder was replaced');
	assert.ok(/<script>[\s\S]{5000,}<\/script>/.test(html), 'app bundle is inlined');
});

test('artifacts: built plugin bundle carries the banner and no dangling sourcemap', () => {
	const bundle = path.join(root, 'main.js');
	if (!existsSync(bundle)) return;
	const body = readFileSync(bundle, 'utf8');
	assert.ok(body.startsWith('// Curtis AI Porter'), 'plugin banner is first');
	assert.ok(body.includes('SPDX-License-Identifier: BUSL-1.1'), 'banner carries the SPDX line');
	assert.ok(!body.includes('sourceMappingURL='), 'no dangling sourceMappingURL');
});
