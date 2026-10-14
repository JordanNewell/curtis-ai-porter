// Mock the porter view at full panel height in both states: empty (hero
// centered) and with results (compact hero, scrolling list, pinned actions).
const { createRequire } = require('node:module');
const path = require('path');
const { readFileSync, existsSync } = require('fs');

// playwright-core is a devDependency of the sibling Curtis plugin repo —
// found under CURTIS_PLUGIN_REPO, ../curtis-ai-chat or ../curtis.
const root = path.resolve(__dirname, '..');
const pluginRepo = [process.env.CURTIS_PLUGIN_REPO, 'curtis-ai-chat', 'curtis']
	.filter(Boolean)
	.map((p) => path.resolve(root, '..', p))
	.find((p) => existsSync(path.join(p, 'package.json')));
if (!pluginRepo) {
	console.error('Curtis plugin repo not found next door — set CURTIS_PLUGIN_REPO to its checkout.');
	process.exit(1);
}
const req = createRequire(path.join(pluginRepo, 'package.json'));
const { chromium } = req('playwright-core');

const css = readFileSync('styles.css', 'utf8');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M22 0 L6.2 0 L2 3.2 L2 15.8 L6.2 19 L9.9 19 L11.4 23 L16.9 19 L22 19 L22 12 L9.2 12 L9.2 5.75 L16 5.75 L16 7.4 L22 7.4 Z"/><path d="M23 8.2 L18.6 8.2 L18.6 7.6 L15.6 8.9 L18.6 10.2 L18.6 9.6 L23 9.6 Z"/><path d="M17 10 L20.4 10 L20.4 9.4 L23.4 10.7 L20.4 12 L20.4 11.4 L17 11.4 Z"/></svg>`;

const vars = ':root{--porter-green:#00f320;--porter-green-ink:#021507;--background-secondary:#262626;--background-secondary-alt:#303030;--background-modifier-border:#3f3f3f;--background-modifier-border-hover:#5a5a5a;--background-modifier-hover:#2e2e2e;--text-normal:#dadada;--text-muted:#9a9a9a;--text-faint:#666;--text-warning:#d9a05a;--font-ui-small:13px;--font-ui-medium:16px;--font-monospace:monospace}';

const shell = (inner) => `<!doctype html><html><head><style>
body { background:#1a1a1a; color:#dadada; font:14px/1.5 -apple-system,'Segoe UI',sans-serif; margin:0 }
#app { width:330px; height:700px; margin-inline-start:30px; border:1px solid #333; box-sizing:border-box }
${css.replace(/:root \{[^}]*\}/, vars)}
input[type=checkbox]{accent-color:#00f320}
</style></head><body><div id="app"><div class="curtis-porter-view">${inner}</div></div></body></html>`;

const drop = `<div class="porter-drop"><div class="porter-drop-big"><span>Drop files here</span></div><div class="porter-drop-sub">ChatGPT export · Claude export · .zip · conversations.json · .curt · Curtis markdown · any role-labeled transcript</div></div>`;
const hero = `<div class="porter-hero"><div class="porter-hero-disc">${icon}</div><div class="porter-hero-title">Curtis Porter</div><div class="porter-hero-tagline">Port your AI chats into this vault. Drop an export below, or paste any transcript — local-first, nothing leaves your machine.</div></div>`;

const chatRow = (title, meta, i) => `<div class="porter-row"><input type="checkbox" checked data-chat="${i}"/><div class="porter-row-main"><div class="porter-row-title">${title}</div><div class="porter-row-meta">${meta}<span class="porter-already">${i === 0 ? "already in vault" : ""}</span></div></div></div>`;
const rows = [
	chatRow('Weekend trip planning', '2 messages · Oct 7, 2026', 0),
	chatRow('Kyoto in November', '4 messages · Dec 29, 2024 · chatgpt · gpt-5.1', 1),
	chatRow('Kubernetes blue-green rollout', '4 messages · Dec 31, 2024 · chatgpt · gpt-4o', 2),
	chatRow('Sourdough emergency', '2 messages · Dec 30, 2024 · chatgpt · gpt-5.1', 3),
	chatRow('Refactor the conversation store', '4 messages · Sep 1, 2026 · claude', 4),
	chatRow('Sci-fi shortlist', '2 messages · Aug 20, 2026 · claude', 5),
	chatRow('Vault-native thinking', '2 messages · Oct 5, 2026 · anthropic', 6),
	chatRow('Local-first means what exactly', '2 messages · Oct 6, 2026 · anthropic · claude-sonnet-4-5', 7),
].join('');

const empty = `${hero}${drop}
<div class="porter-paste"><div class="porter-paste-head">Paste a transcript</div><div class="porter-hint">DeepSeek, Gemini, mobile — any app without an export button. Mark the speakers (You: / AI: or ## You headings); both sides must be found.</div><textarea class="porter-paste-text" placeholder="# Weekend planning&#10;&#10;You: Two days in Lisbon with kids?&#10;&#10;AI: Keep it to one neighborhood a day…"></textarea><div class="porter-row-end"><button class="porter-primary">Convert pasted transcript</button></div></div>
<div class="porter-why"><div class="porter-why-row"><span class="porter-why-lead">Whole history, not one chat — </span><span>an export zip becomes checked-off conversations with titles, dates and order preserved.</span></div><div class="porter-why-row"><span class="porter-why-lead">Apps without an export button — </span><span>paste a DeepSeek or Gemini chat as-is and it becomes a real conversation.</span></div><div class="porter-why-row"><span class="porter-why-lead">Portable by default — </span><span>writes .curt copies alongside the markdown, and re-running an export never duplicates.</span></div></div>`;
const withResults = `<div class="porter-hero porter-compact"><div class="porter-hero-disc">${icon}</div><div class="porter-hero-title">Curtis Porter</div></div>${drop}
<div class="porter-status"></div>
<div class="porter-sources"><div class="porter-chip"><span class="porter-chip-name">chatgpt-export.zip</span> ChatGPT export · 3 chats</div><div class="porter-chip"><span class="porter-chip-name">claude-export.json</span> Claude export · 2 chats</div><div class="porter-chip"><span class="porter-chip-name">curtis-chats-demo.zip</span> Curtis (.curt) · 2 chats</div></div>
<div class="porter-list-outer"><div class="porter-list-label">8 conversations found</div><div class="porter-list">${rows}</div></div>
<div class="porter-actions"><button class="porter-primary">Write to vault</button><button class="porter-ghost">Download .curt (zip)</button><button class="porter-ghost">Download both (zip)</button><button class="porter-ghost">Clear</button></div>`;

(async () => {
	const browser = await chromium.launch({ channel: 'msedge', headless: true });
	const page = await browser.newPage({ viewport: { width: 400, height: 740 }, deviceScaleFactor: 2 });
	await page.setContent(shell(empty));
	await page.screenshot({ path: 'demo/_shots/porter-empty.png' });
	await page.setContent(shell(withResults));
	await page.evaluate(() => document.querySelector('.curtis-porter-view').classList.add('porter-has-chats'));
	await page.screenshot({ path: 'demo/_shots/porter-results.png' });
	await browser.close();
	console.log('written demo/_shots/porter-empty.png + porter-results.png');
})();
