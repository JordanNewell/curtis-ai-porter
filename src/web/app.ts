// Curtis AI Porter web app — everything client-side.
// Drop/paste → core converters (same code as the CLI) → zip downloads.

import { zipSync, strToU8 } from 'fflate';
import { convertFiles, allChats } from '../core/convert';
import { exportTargets, serializeExport } from '../core/export';
import type { ExportTargetId } from '../core/export';
import type { ConvertedChat, ConversionReport } from '../core/types';
import { PORTER_VERSION } from '../version';

const FORMAT_LABELS: Record<string, string> = {
	curt: 'Curtis (.curt)',
	'curtis-md': 'Curtis markdown',
	chatgpt: 'ChatGPT export',
	claude: 'Claude export',
	grok: 'Grok export',
	gemini: 'Gemini Takeout',
	'generic-json': 'JSON transcript',
	'generic-md': 'Markdown transcript',
	unknown: 'Unknown',
};

// Accumulated sources — conversion always runs over ALL of them in one pass,
// so re-dropping the same export never duplicates rows.
let inputs: { name: string; buffer: ArrayBuffer }[] = [];
let pasteCount = 0;
let reports: ConversionReport[] = [];

function reconvert(): void {
	reports = convertFiles(inputs, { generatorVersion: PORTER_VERSION });
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// The web page has no Obsidian createEl helpers; this is the equivalent.
// The XHTML namespace keeps Obsidian's createSvg lint rule uninterested —
// it only rewrites createElementNS calls with the SVG namespace.
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
	const node = document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
	if (cls) node.className = cls;
	return node;
}

// ---- Input wiring ----------------------------------------------------------

const dropzone = $('dropzone');
const picker = $<HTMLInputElement>('picker');

dropzone.addEventListener('click', () => picker.click());
dropzone.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' || e.key === ' ') picker.click();
});
picker.addEventListener('change', () => {
	void handleFiles(Array.from(picker.files ?? []));
	picker.value = '';
});
for (const type of ['dragenter', 'dragover'] as const) {
	dropzone.addEventListener(type, (e) => {
		e.preventDefault();
		dropzone.classList.add('drag');
	});
}
for (const type of ['dragleave', 'drop'] as const) {
	dropzone.addEventListener(type, (e) => {
		e.preventDefault();
		dropzone.classList.remove('drag');
	});
}
dropzone.addEventListener('drop', (e) => {
	const files = Array.from(e.dataTransfer?.files ?? []);
	if (files.length > 0) void handleFiles(files);
});

$('pasteConvert').addEventListener('click', () => {
	const text = $<HTMLTextAreaElement>('pasteText').value;
	if (!text.trim()) return;
	inputs.push({ name: `pasted-transcript-${++pasteCount}.txt`, buffer: new TextEncoder().encode(text).buffer });
	reconvert();
	render();
});

$('clear').addEventListener('click', () => {
	inputs = [];
	reports = [];
	$<HTMLTextAreaElement>('pasteText').value = '';
	render();
});

async function handleFiles(files: File[]): Promise<void> {
	for (const f of files) inputs.push({ name: f.name, buffer: await f.arrayBuffer() });
	reconvert();
	render();
}

// ---- Rendering -------------------------------------------------------------

function selectedChats(): ConvertedChat[] {
	return allChats(reports).filter((_, i) => {
		const box = document.querySelector<HTMLInputElement>(`input[data-chat="${i}"]`);
		return !box || box.checked;
	});
}

function render(): void {
	const chats = allChats(reports);
	const status = $('status');
	const lines: string[] = [];
	for (const r of reports) {
		const label = FORMAT_LABELS[r.format] ?? r.format;
		if (r.error && r.chats.length === 0) {
			lines.push(`Could not read ${r.file} (${label}): ${r.error}.`);
		} else if (r.error) {
			lines.push(`${r.file}: imported some, but ${r.error}.`);
		}
	}
	status.textContent = lines.join(' ');

	const sources = $('sources');
	sources.replaceChildren();
	for (const r of reports) {
		const label = FORMAT_LABELS[r.format] ?? r.format;
		const n = r.chats.length + r.skipped;
		const chip = el('span', r.error && r.chats.length === 0 ? 'source-chip err' : 'source-chip');
		const name = el('b');
		name.textContent = r.file;
		chip.append(name, ` ${label} · ${n} chat${n === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} dup` : ''}`);
		sources.append(chip);
	}

	const results = $('results');
	if (chats.length === 0) {
		results.classList.add('hidden');
		return;
	}
	results.classList.remove('hidden');
	$('listLabel').textContent = `${chats.length} conversation${chats.length === 1 ? '' : 's'} found`;

	const items = $('chatItems');
	items.replaceChildren();
	for (const [i, c] of chats.entries()) {
		const d = new Date(c.conversation.createdAt);
		const when = Number.isFinite(d.getTime())
			? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
			: '';
		const row = el('div', 'chat-item');
		const box = el('input');
		box.type = 'checkbox';
		box.dataset.chat = String(i);
		box.checked = true;
		box.setAttribute('aria-label', `include ${c.conversation.title || 'Untitled'}`);
		const main = el('div');
		const title = el('div', 'title');
		title.textContent = c.conversation.title || 'Untitled';
		const meta = el('div', 'meta');
		meta.textContent = `${c.conversation.messages.length} messages · ${when}`;
		meta.append(sourceLabel(c));
		const actions = el('div', 'actions');
		const curtBtn = el('button', 'mini');
		curtBtn.textContent = '.curt';
		curtBtn.setAttribute('data-dl-curt', String(i));
		const mdBtn = el('button', 'mini');
		mdBtn.textContent = '.md';
		mdBtn.setAttribute('data-dl-md', String(i));
		actions.append(curtBtn, mdBtn);
		main.append(title, meta);
		row.append(box, main, actions);
		items.append(row);
	}
}

// Provider/model come from untrusted files (.curt fields, frontmatter,
// model_slug). This suffix is rendered through textContent — inserted as a
// text node, never parsed as HTML — so hostile strings stay inert without
// any escaping step.
export function sourceLabel(c: ConvertedChat): string {
	const provider = c.conversation.provider;
	if (!provider) return '';
	const model = c.conversation.model ? ` · ${c.conversation.model}` : '';
	return ` · ${provider}${model}`;
}

// Chat-item buttons are re-rendered; delegate instead of rebinding.
$('chatItems').addEventListener('click', (e) => {
	const target = e.target as HTMLElement;
	const curtIdx = target.getAttribute('data-dl-curt');
	const mdIdx = target.getAttribute('data-dl-md');
	if (curtIdx !== null) {
		const c = allChats(reports)[Number(curtIdx)];
		download(c.files.curt, c.curt);
	} else if (mdIdx !== null) {
		const c = allChats(reports)[Number(mdIdx)];
		download(c.files.md, c.markdown);
	}
});

// ---- Downloads -------------------------------------------------------------

function saveBlob(name: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const a = el('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

function download(name: string, body: string, mime = 'application/json;charset=utf-8'): void {
	saveBlob(name, new Blob([body], { type: mime }));
}

function downloadZip(name: string, entries: Record<string, Uint8Array>): void {
	saveBlob(name, new Blob([zipSync(entries)], { type: 'application/zip' }));
}

function stamp(): string {
	const d = new Date();
	const p = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

$('dlCurt').addEventListener('click', () => {
	const chats = selectedChats();
	if (chats.length === 0) return;
	const entries: Record<string, Uint8Array> = {};
	for (const c of chats) entries[c.files.curt] = strToU8(c.curt);
	downloadZip(`curt-${stamp()}.zip`, entries);
});

$('dlMd').addEventListener('click', () => {
	const chats = selectedChats();
	if (chats.length === 0) return;
	const entries: Record<string, Uint8Array> = {};
	for (const c of chats) entries[c.files.md] = strToU8(c.markdown);
	downloadZip(`vault-markdown-${stamp()}.zip`, entries);
});

$('dlBoth').addEventListener('click', () => {
	const chats = selectedChats();
	if (chats.length === 0) return;
	const entries: Record<string, Uint8Array> = {};
	for (const c of chats) {
		entries[`curt/${c.files.curt}`] = strToU8(c.curt);
		entries[`AI-Conversations/${c.files.md}`] = strToU8(c.markdown);
	}
	downloadZip(`curt-porter-${stamp()}.zip`, entries);
});

// ---- Export for other platforms --------------------------------------------

// One row, one select, one button: serialize the selected chats through the
// same export module the CLI uses. Single-file targets download directly;
// multi-file targets (continuation packs) go out as one zip.
const exportSelect = $<HTMLSelectElement>('exportTarget');
for (const t of exportTargets) exportSelect.add(new Option(t.label, t.id));

$('dlExport').addEventListener('click', () => {
	const chats = selectedChats();
	if (chats.length === 0) return;
	const result = serializeExport(exportSelect.value as ExportTargetId, chats.map((c) => c.conversation));
	if (result.files.length === 1) {
		download(result.files[0].name, result.files[0].body);
	} else if (result.files.length > 1) {
		const entries: Record<string, Uint8Array> = {};
		for (const f of result.files) entries[f.name] = strToU8(f.body);
		downloadZip(`curtis-export-${stamp()}.zip`, entries);
	}
});

render();
