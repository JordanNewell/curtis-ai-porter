// Drive the porter web UI end to end and screenshot it:
//   node demo/drive-porter.mjs
// Opens dist/porter.html headless, runs a pasted DeepSeek-style transcript
// through the real UI pipeline, then drags the two fixture files in via the
// file input, and saves screenshots to demo/_shots/.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path2 from 'node:path';
import { createRequire } from 'node:module';

const here = path2.dirname(fileURLToPath(import.meta.url));
const root = path2.dirname(here);

// playwright-core is a devDependency of the sibling Curtis plugin repo —
// found under CURTIS_PLUGIN_REPO, ../curtis-ai-chat or ../curtis.
const pluginRepo = [process.env.CURTIS_PLUGIN_REPO, 'curtis-ai-chat', 'curtis']
	.filter(Boolean)
	.map((p) => path2.resolve(root, '..', p))
	.find((p) => existsSync(path2.join(p, 'package.json')));
if (!pluginRepo) {
	console.error('Curtis plugin repo not found next door — set CURTIS_PLUGIN_REPO to its checkout.');
	process.exit(1);
}
const requireFromPlugin = createRequire(path2.join(pluginRepo, 'package.json'));
const { chromium } = requireFromPlugin('playwright-core');

const shots = path2.join(here, '_shots');
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1200 }, deviceScaleFactor: 2 });
await page.goto('file:///' + root.replace(/\\/g, '/') + '/dist/porter.html');

// 1. Paste flow — a DeepSeek-style copy/paste transcript. (The paste box is
// always visible since the export batch; nothing to toggle.)
await page.fill('#pasteText', `# Weekend trip planning

## You

Two days around Lisbon with kids, nothing too ambitious?

## AI

Keep it to one neighborhood a day. Day 1: Belem — riverside park, the monastery cloisters, and the tram. Day 2: Alfama — the miradouros, a tram 28 loop, and downtime at the fado garden.
`);
await page.click('#pasteConvert');
await page.waitForSelector('.chat-item');

// 2. File input — ChatGPT zip + Claude export + bulk zip together.
await page.setInputFiles('#picker', [
	path2.join(root, 'demo', 'fixtures', 'chatgpt-export.zip'),
	path2.join(root, 'demo', 'fixtures', 'claude-export.json'),
	path2.join(root, 'demo', 'fixtures', 'curtis-chats-demo.zip'),
]);
await page.waitForFunction(() => document.querySelectorAll('.chat-item').length >= 8);

const summary = await page.evaluate(() => ({
	chats: document.querySelectorAll('.chat-item').length,
	label: document.getElementById('listLabel').textContent,
	sources: [...document.querySelectorAll('.source-chip')].map((c) => c.textContent.trim()),
}));

await page.screenshot({ path: path2.join(shots, 'porter-results.png'), fullPage: true });

// 3. Exercise a real download: first conversation as .curt.
const downloadPromise = page.waitForEvent('download');
await page.click('button[data-dl-curt="0"]');
const download = await downloadPromise;
const target = path2.join(shots, 'downloaded.curt');
await download.saveAs(target);
const bytes = readFileSync(target);

console.log(JSON.stringify({ ...summary, download: download.suggestedFilename(), curtBytes: bytes.reduce((n, b) => n + b.length, 0) }, null, 2));
await browser.close();
