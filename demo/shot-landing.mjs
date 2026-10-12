// Screenshot the landing page (site/index.html) for a quick visual check.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const requireFromPlugin = createRequire('E:/dev/projects/curtis-ai-chat/package.json');
const { chromium } = requireFromPlugin('playwright-core');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await page.goto('file:///' + root.replace(/\\/g, '/') + '/site/index.html');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(root, 'demo', '_shots', 'site-landing.png'), fullPage: true });
await browser.close();
console.log('saved demo/_shots/site-landing.png');
