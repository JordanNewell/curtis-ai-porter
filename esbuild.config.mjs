// Build: CLI bundle, single-file web page, and test bundles.
//   node esbuild.config.mjs          → dist/cli.mjs + dist/porter.html
//   node esbuild.config.mjs tests    → dist-test/*.test.mjs (obsidian aliased to the stub)
//   node esbuild.config.mjs watch    → rebuild CLI + web on change

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? '';
const production = process.env.NODE_ENV === 'production';

/** Bundle the browser app and inline it into index.html → dist/porter.html. */
async function buildWeb() {
	const result = await build({
		entryPoints: [path.join(root, 'src/web/app.ts')],
		bundle: true,
		format: 'iife',
		target: 'es2022',
		minify: production,
		write: false,
	});
	const js = result.outputFiles[0].text;
	const html = readFileSync(path.join(root, 'src/web/index.html'), 'utf8');
	// Inline as a real script element; escape closing-tag sequences so string
	// literals in the bundle can't terminate the element early.
	const safeJs = js.replace(/<\/script/gi, '<\\/script');
	const out = html.replace('<!--PORTER_APP_JS-->', () => `<script>\n${safeJs}\n</script>`);
	mkdirSync(path.join(root, 'dist'), { recursive: true });
	writeFileSync(path.join(root, 'dist/porter.html'), out);
}

async function buildCli() {
	await build({
		// cli/ is the Node-only surface; src/ stays browser-safe for the
		// Obsidian review's mobile scan (see AGENTS.md).
		entryPoints: [path.join(root, 'cli/index.ts')],
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node18',
		// Real runtime deps — Node resolves them from node_modules. Bundling
		// yaml's CJS build into ESM output breaks on its require() of builtins.
		external: ['fflate', 'yaml'],
		// No banner: cli/index.ts carries the #! shebang and esbuild hoists it.
		outfile: 'dist/cli.mjs',
		sourcemap: !production,
	});
}

async function buildTests() {
	const entries = ['test/curt.test.ts', 'test/parsers.test.ts', 'test/detect.test.ts', 'test/export.test.ts', 'test/robustness.test.ts', 'test/cli.test.ts', 'test/continuation.test.ts', 'test/stats.test.ts', 'test/verify.test.ts', 'test/audit.test.ts', 'test/curtis-contract.test.ts', 'test/smoke.test.ts', 'test/artifacts.test.ts'];
	// The live-repo contract run only exists when the plugin repo is checked
	// out next door — under its GitHub name (curtis-ai-chat), a local rename
	// (curtis), or pointed at explicitly via CURTIS_PLUGIN_REPO. The vendored
	// snapshot keeps `npm test` self-contained without it. The live imports
	// go through the `curtis-live` alias so the entry is name-agnostic.
	const curtisSibling = [process.env.CURTIS_PLUGIN_REPO, '../curtis-ai-chat', '../curtis']
		.filter(Boolean)
		.map((p) => path.resolve(root, p))
		.find((p) => existsSync(path.join(p, 'src/import/curt.ts')));
	if (curtisSibling) entries.push(path.relative(root, path.join(root, 'test/curtis-contract-live.test.ts')));
	rmSync(path.join(root, 'dist-test'), { recursive: true, force: true });
	mkdirSync(path.join(root, 'dist-test'), { recursive: true });
	await build({
		entryPoints: entries.map((e) => path.join(root, e)),
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node18',
		outdir: 'dist-test',
		external: ['fflate', 'yaml'],
		sourcemap: false,
		alias: {
			obsidian: path.join(root, 'test/obsidian-stub.ts'),
			...(curtisSibling ? { 'curtis-live': curtisSibling } : {}),
		},
	});
}

/** Obsidian plugin bundle: src/plugin/main.ts → main.js at the repo root
 *  (standard plugin layout — manifest.json sits next to it). No sourcemap:
 *  the map is never shipped with the release, so a dangling sourceMappingURL
 *  comment would only break byte-reproducibility of the released asset. */
async function buildPlugin() {
	await build({
		entryPoints: [path.join(root, 'src/plugin/main.ts')],
		bundle: true,
		format: 'cjs',
		platform: 'browser',
		target: 'es2022',
		external: ['obsidian'],
		banner: {
			js: '// Curtis AI Porter — Copyright (c) 2026 Jordan Newell (Curtis AI)\n// SPDX-License-Identifier: BUSL-1.1',
		},
		outfile: 'main.js',
		sourcemap: false,
	});
}

if (mode === 'tests') {
	await buildTests();
} else {
	await Promise.all([buildCli(), buildWeb(), buildPlugin()]);
	if (mode === 'watch') {
		const { watch } = await import('node:fs');
		let timer = null;
		for (const dir of ['src']) {
			watch(path.join(root, dir), { recursive: true }, () => {
				clearTimeout(timer);
				timer = setTimeout(() => void Promise.all([buildCli(), buildWeb(), buildPlugin()]), 100);
			});
		}
		console.log('watching src/ …');
	}
}
