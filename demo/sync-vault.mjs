// Install the Curtis + Curtis AI Porter plugin builds and Obsidian config into
// demo/demo-vault-2.
//   node demo/sync-vault.mjs
// Expects curtis-ai-chat checked out at ../curtis-ai-chat (with a fresh
// `npm run build`) and this repo's own main.js built (`npm run build` here).

import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const curtis = path.join(root, '..', 'curtis-ai-chat');
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
