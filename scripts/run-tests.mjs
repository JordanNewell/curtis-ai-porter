// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Test runner shim: hands every built bundle in dist-test/ to `node --test`
// as explicit paths. Needed because node --test only expands glob arguments
// from v21, and directory/default discovery either misses the bundles or
// sweeps in the raw test/*.ts sources (which only run through the esbuild
// alias for the obsidian stub). An explicit list works on Node 18-24, all OSes.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(root, '..', 'dist-test');
const files = readdirSync(dir)
	.filter((f) => f.endsWith('.test.js'))
	.map((f) => path.join(dir, f))
	.sort();

if (files.length === 0) {
	console.error('No test bundles in dist-test — run `node esbuild.config.mjs tests` first.');
	process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
