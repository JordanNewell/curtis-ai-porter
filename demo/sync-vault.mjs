// Install the Curtis + Curtis AI Porter plugin builds and Obsidian config into
// demo/demo-vault-2.
//   node demo/sync-vault.mjs
// Expects the Curtis plugin repo checked out next door (with a fresh
// `npm run build` there) and this repo's own main.js built (`npm run build`
// here). The plugin repo is looked up under CURTIS_PLUGIN_REPO, ../curtis-ai-chat
// or ../curtis — whichever exists.

import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const curtis = [process.env.CURTIS_PLUGIN_REPO, '../curtis-ai-chat', '../curtis']
	.filter(Boolean)
	.map((p) => path.resolve(root, p))
	.find((p) => existsSync(path.join(p, 'package.json')));
if (!curtis) {
	console.error('Curtis plugin repo not found next door — set CURTIS_PLUGIN_REPO to its checkout.');
	process.exit(1);
}
const vault = path.join(here, 'demo-vault-2');

const plugins = [
	{ id: 'curtis-ai-chat', from: curtis },
	{ id: 'curtis-ai-porter', from: root },
];

for (const { id, from } of plugins) {
	const pluginDir = path.join(vault, '.obsidian', 'plugins', id);
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		const src = path.join(from, f);
		if (!existsSync(src)) {
			console.error(`Missing ${src} — build that repo first.`);
			process.exit(1);
		}
		mkdirSync(pluginDir, { recursive: true });
		copyFileSync(src, path.join(pluginDir, f));
	}
}

mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
writeFileSync(
	path.join(vault, '.obsidian', 'community-plugins.json'),
	JSON.stringify(plugins.map((p) => p.id), null, 2)
);
writeFileSync(
	path.join(vault, '.obsidian', 'appearance.json'),
	JSON.stringify({ theme: 'obsidian', accentColor: '00f320' }, null, 2)
);
writeFileSync(path.join(vault, '.obsidian', 'app.json'), JSON.stringify({}, null, 2));

mkdirSync(path.join(vault, 'AI', 'Conversations'), { recursive: true });
console.log('demo-vault-2 ready (Curtis + Curtis AI Porter):', vault);
