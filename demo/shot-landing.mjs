// Screenshot the landing page (site/index.html) for a quick visual check.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

// playwright-core is a devDependency of the sibling Curtis plugin repo —
// found under CURTIS_PLUGIN_REPO, ../curtis-ai-chat or ../curtis.
const pluginRepo = [process.env.CURTIS_PLUGIN_REPO, 'curtis-ai-chat', 'curtis']
	.filter(Boolean)
	.map((p) => path.resolve(root, '..', p))
	.find((p) => existsSync(path.join(p, 'package.json')));
if (!pluginRepo) {
	console.error('Curtis plugin repo not found next door — set CURTIS_PLUGIN_REPO to its checkout.');
	process.exit(1);
}
const requireFromPlugin = createRequire(path.join(pluginRepo, 'package.json'));
const { chromium } = requireFromPlugin('playwright-core');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await page.goto('file:///' + root.replace(/\\/g, '/') + '/site/index.html');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(root, 'demo', '_shots', 'site-landing.png'), fullPage: true });
await browser.close();
console.log('saved demo/_shots/site-landing.png');
