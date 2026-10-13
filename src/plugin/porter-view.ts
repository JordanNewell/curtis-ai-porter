// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Curtis AI Porter view — the drop-zone workspace inside Obsidian.
//
// Drop or pick foreign exports, paste transcripts, review what was found,
// then write vault-ready markdown (+ .curt copies) into the output folder.
// All conversion runs through src/core — the same code as the CLI and the
// standalone web page — so the three surfaces never drift.
//
// State model: dropped/pasted inputs ACCUMULATE and the conversion is
// recomputed over all of them in one pass — re-dropping an export never
// duplicates rows, and results never vanish on interaction. A skipped-only
// write keeps the workspace and explains itself inline; rows already in the
// vault are flagged before you write anything.

import { ItemView, Notice, Platform, setIcon, WorkspaceLeaf, normalizePath } from 'obsidian';
import { zipSync, strToU8 } from 'fflate';
import type PorterPlugin from './main';
import { PORTER_ICON_ID } from './icons';
import { convertFiles, allChats } from '../core/convert';
import { conversationDedupeKey } from '../core/detect';
import type { ConvertedChat, ConversionReport as Report } from '../core/types';
import type { ConvertInput } from '../core/convert';
import { downloadBlob, refreshCurtisViews, scanVaultKeys, writeConversions, type WriteSummary } from './write';

export const PORTER_VIEW_TYPE = 'curtis-porter-view';

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

/** Extension-aware hint for files we couldn't read — the user usually just
 *  picked the wrong file out of the export folder, so point at the right one. */
function errorHint(file: string): string {
	const ext = file.toLowerCase().split('.').pop() || '';
	if (ext === 'json') return 'If this is a ChatGPT or Claude export, drop the export ZIP or its conversations.json — other .json files aren’t transcripts.';
	if (ext === 'md' || ext === 'txt') return 'No confident speaker labels found — mark the sides like “You:” and “AI:” (or ## You headings) so both sides of the conversation exist.';
	if (ext === 'zip') return 'No chats inside this zip — is it the actual data export? (For ChatGPT/Claude it contains conversations.json; a zip of .curt files also works.)';
	return 'Try the original export ZIP or a transcript with labeled speakers.';
}

export class PorterView extends ItemView {
	private plugin: PorterPlugin;
	/** Accumulated source files — the single source of truth for results. */
	private inputs: ConvertInput[] = [];
	private reports: Report[] = [];
	private pasteCount = 0;
	private filter = '';
	/** Vault presence for the current output folder (pre-write "already in vault" chips). */
	private vaultKeys: { ids: Set<string>; keys: Set<string> } | null = null;
	/** Set after a successful write — swaps the view into its confirmation state. */
	private lastWrite: { summary: WriteSummary; folder: string } | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: PorterPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = false;
	}

	getViewType(): string {
		return PORTER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Curtis AI Porter';
	}

	getIcon(): string {
		return PORTER_ICON_ID;
	}

	onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('curtis-porter-view');

		// Empty-state hero — same class of product as Curtis's chat empty
		// state: centered disc, wordmark, one quiet line underneath.
		const hero = root.createDiv({ cls: 'porter-hero' });
		const disc = hero.createDiv({ cls: 'porter-hero-disc' });
		setIcon(disc, PORTER_ICON_ID);
		hero.createDiv({ cls: 'porter-hero-title', text: 'Curtis AI Porter' });
		hero.createDiv({
			cls: 'porter-hero-tagline',
			text: 'Move your entire AI chat history into this vault — ChatGPT, Claude, DeepSeek, anything — in one drop.',
		});

		// Write confirmation — the "then what?" state. Shown instead of the
		// workspace after a successful write, until Done.
		const success = root.createDiv({ cls: 'porter-success porter-hidden' });
		const successDisc = success.createDiv({ cls: 'porter-success-disc' });
		setIcon(successDisc, 'check');
		success.createDiv({ cls: 'porter-success-title', text: 'Ported into this vault' });
		const successMeta = success.createDiv({ cls: 'porter-success-meta' });
		success.createDiv({ cls: 'porter-success-note', text: 'Nothing was overwritten — re-running the same export is always safe.' });
		const successActions = success.createDiv({ cls: 'porter-success-actions' });
		const showBtn = successActions.createEl('button', { cls: 'porter-primary', text: 'Show in file explorer' });
		const curtisBtn = successActions.createEl('button', { cls: 'porter-ghost', text: 'Open in Curtis' });
		const doneBtn = successActions.createEl('button', { cls: 'porter-ghost', text: 'Done' });

		const drop = root.createDiv({ cls: 'porter-drop' });
		drop.createDiv({ cls: 'porter-drop-big' }).createSpan({ text: 'Drop files here' });
		drop.createDiv({
			cls: 'porter-drop-sub',
			text: 'ChatGPT · Claude · Grok · Gemini Takeout · .zip · conversations.json · .curt · Curtis markdown · any labeled transcript (中文也认)',
		});
		const picker = drop.createEl('input', { type: 'file' });
		picker.addClass('porter-hidden');
		picker.multiple = true;
		picker.accept = '.zip,.json,.curt,.md,.txt';
		this.registerDomEvent(drop, 'click', () => picker.click());
		for (const type of ['dragenter', 'dragover'] as const) {
			this.registerDomEvent(drop, type, (e) => {
				e.preventDefault();
				drop.addClass('porter-drag');
			});
		}
		for (const type of ['dragleave', 'drop'] as const) {
			this.registerDomEvent(drop, type, (e) => {
				e.preventDefault();
				drop.removeClass('porter-drag');
			});
		}
		this.registerDomEvent(drop, 'drop', (e) => {
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (files.length > 0) void this.ingest(files);
		});
		this.registerDomEvent(picker, 'change', () => {
			void this.ingest(Array.from(picker.files ?? []));
			picker.value = '';
		});

		// Paste box stays open — it's the zero-friction path for apps without
		// an export button, and it earns its space in the panel.
		const paste = root.createDiv({ cls: 'porter-paste' });
		paste.createDiv({ cls: 'porter-paste-head', text: 'Paste a transcript' });
		paste.createDiv({
			cls: 'porter-hint',
			text: 'DeepSeek, Kimi, 豆包, MiniMax — any app without an export button. Label the speakers (You:/AI:, 我:/AI:, ## 用户/助手); both sides must be found.',
		});
		const pasteText = paste.createEl('textarea', { cls: 'porter-paste-text' });
		pasteText.placeholder = '# Weekend planning\n\nYou: Two days in Lisbon with kids?\n\nAI: Keep it to one neighborhood a day…';
		const pasteRow = paste.createDiv({ cls: 'porter-row-end' });
		const convertBtn = pasteRow.createEl('button', { cls: 'porter-primary', text: 'Convert pasted transcript' });
		this.registerDomEvent(convertBtn, 'click', () => {
			const text = pasteText.value;
			if (!text.trim()) return;
			this.addInputs([{ name: `pasted-transcript-${++this.pasteCount}.txt`, buffer: new TextEncoder().encode(text).buffer }]);
			pasteText.value = '';
		});

		// Why this exists — answered on sight, not in a README.
		const why = root.createDiv({ cls: 'porter-why' });
		const whyRow = (lead: string, rest: string): void => {
			const row = why.createDiv({ cls: 'porter-why-row' });
			row.createSpan({ cls: 'porter-why-lead', text: lead });
			row.createSpan({ text: rest });
		};
		whyRow('Whole history, not one chat — ', 'an export zip becomes checked-off conversations with titles, dates and order preserved.');
		whyRow('Apps without an export button — ', 'paste a DeepSeek or Gemini chat as-is and it becomes a real conversation.');
		whyRow('Portable by default — ', 'writes .curt copies alongside the markdown, and re-running an export never duplicates.');

		const status = root.createDiv({ cls: 'porter-status' });
		const sources = root.createDiv({ cls: 'porter-sources' });
		const listWrap = root.createDiv({ cls: 'porter-list-outer porter-hidden' });
		const listLabel = listWrap.createDiv({ cls: 'porter-row-between' });
		listLabel.createDiv({ cls: 'porter-list-label', text: '' }).addClass('porter-list-count');
		const filter = listLabel.createEl('input', { type: 'text', cls: 'porter-filter porter-hidden' });
		filter.placeholder = 'Filter by title…';
		const list = listWrap.createDiv({ cls: 'porter-list' });
		const actions = root.createDiv({ cls: 'porter-actions porter-hidden' });
		const writeBtn = actions.createEl('button', { cls: 'porter-primary', text: 'Write to vault' });
		const zipBtn = actions.createEl('button', { cls: 'porter-ghost', text: 'Download .curt (zip)' });
		const bothBtn = actions.createEl('button', { cls: 'porter-ghost', text: 'Download both (zip)' });
		const clearBtn = actions.createEl('button', { cls: 'porter-ghost', text: 'Clear' });

		// Trust footer — where files land, always visible, one click to change.
		const footer = root.createDiv({ cls: 'porter-footer' });
		const folderSpan = footer.createSpan({ cls: 'porter-footer-folder' });
		footer.createSpan({ text: ' · ' });
		footer.createEl('button', { cls: 'porter-footer-link', text: 'Settings' });

		this.registerDomEvent(writeBtn, 'click', () => void this.writeSelected());
		this.registerDomEvent(zipBtn, 'click', () => this.downloadSelected('curt'));
		this.registerDomEvent(bothBtn, 'click', () => this.downloadSelected('both'));
		this.registerDomEvent(clearBtn, 'click', () => {
			this.inputs = [];
			this.reports = [];
			this.lastWrite = null;
			this.vaultKeys = null;
			pasteText.value = '';
			this.render();
		});
		this.registerDomEvent(showBtn, 'click', () => {
			if (!this.lastWrite) return;
			if (Platform.isDesktopApp) {
				try {
					(this.app as unknown as { shell?: { openPath?: (p: string) => void } }).shell?.openPath?.(normalizePath(this.lastWrite.folder));
				} catch {
					new Notice(`Files are in ${this.lastWrite.folder}`);
				}
			} else {
				new Notice(`Files are in ${this.lastWrite.folder}`);
			}
		});
		this.registerDomEvent(curtisBtn, 'click', () => {
			const curtis = (
				this.app as unknown as { plugins?: { plugins?: Record<string, { activateChatView?: () => void }> } }
			).plugins?.plugins?.['curtis-ai-chat'];
			if (curtis?.activateChatView) {
				curtis.activateChatView();
			} else {
				new Notice('Curtis AI Chat isn’t installed — the files are plain notes either way.');
			}
		});
		this.registerDomEvent(doneBtn, 'click', () => {
			this.lastWrite = null;
			this.render();
		});
		this.registerDomEvent(filter, 'input', () => {
			this.filter = filter.value;
			this.renderList();
		});
		this.registerDomEvent(footer.querySelector('.porter-footer-link') as HTMLElement, 'click', () => {
			const setting = (this.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
			if (setting?.open && setting?.openTabById) {
				setting.open();
				setting.openTabById(this.plugin.manifest.id);
			}
		});

		// Stash element references for render().
		this.el = { hero, success, successMeta, showBtn, curtisBtn, drop, paste, why, status, sources, listWrap, listCount: listLabel.querySelector('.porter-list-count') as HTMLElement, filter, list, actions, footerFolder: folderSpan };
		this.render();
		return Promise.resolve();
	}

	private el!: {
		hero: HTMLElement;
		success: HTMLElement;
		successMeta: HTMLElement;
		showBtn: HTMLElement;
		curtisBtn: HTMLElement;
		drop: HTMLElement;
		paste: HTMLElement;
		why: HTMLElement;
		status: HTMLElement;
		sources: HTMLElement;
		listWrap: HTMLElement;
		listCount: HTMLElement;
		filter: HTMLInputElement;
		list: HTMLElement;
		actions: HTMLElement;
		footerFolder: HTMLElement;
	};

	/** Add inputs and reconvert everything in one pass — cross-drop dedupe is
	 *  inherent, and results can never silently vanish between interactions. */
	private addInputs(inputs: ConvertInput[]): void {
		this.inputs.push(...inputs);
		this.lastWrite = null;
		this.reports = convertFiles(this.inputs, { generatorVersion: this.plugin.manifest.version });
		this.render();
		void this.refreshVaultKeys();
	}

	private async ingest(files: File[]): Promise<void> {
		const inputs = [];
		for (const f of files) inputs.push({ name: f.name, buffer: await f.arrayBuffer() });
		this.addInputs(inputs);
	}

	private async refreshVaultKeys(): Promise<void> {
		try {
			this.vaultKeys = await scanVaultKeys(this.app, this.plugin.settings.outputFolder);
			this.renderList();
		} catch {
			this.vaultKeys = null;
		}
	}

	private selectedChats(): ConvertedChat[] {
		return allChats(this.reports).filter((_, i) => {
			const box = this.contentEl.querySelector<HTMLInputElement>(`input[data-chat="${i}"]`);
			return !box || box.checked;
		});
	}

	private async writeSelected(): Promise<void> {
		const chats = this.selectedChats();
		if (chats.length === 0) return;
		try {
			const { summary } = await writeConversions(
				this.app,
				this.plugin.settings.outputFolder,
				this.plugin.settings.saveCurt,
				chats
			);
			refreshCurtisViews(this.app);
			if (summary.written === 0 && summary.failed.length === 0) {
				// Skipped-only: keep the workspace, explain inline — results must
				// never feel like they vanished.
				this.el.status.setText(
					`All ${summary.skipped} conversation${summary.skipped === 1 ? ' is' : 's are'} already in ${this.plugin.settings.outputFolder} — nothing duplicated, nothing lost.`
				);
				new Notice(`Curtis AI Porter: all ${summary.skipped} already present — nothing duplicated`, 5000);
				void this.refreshVaultKeys();
				return;
			}
			if (summary.written === 0) {
				// Nothing landed — keep the workspace and say what blocked it.
				new Notice(`Curtis AI Porter: ${summary.failed.length} failed — ${summary.failed[0]}`, 8000);
				void this.refreshVaultKeys();
				return;
			}
			this.lastWrite = { summary, folder: this.plugin.settings.outputFolder };
			this.inputs = [];
			this.reports = [];
			this.render();
		} catch (e) {
			// A failed write must never leave the view dead — say so and carry on.
			new Notice(`Curtis AI Porter: ${e instanceof Error ? e.message : String(e)}`, 8000);
		}
	}

	private downloadSelected(mode: 'curt' | 'both'): void {
		const chats = this.selectedChats();
		if (chats.length === 0) return;
		const entries: Record<string, Uint8Array> = {};
		for (const c of chats) {
			entries[c.files.curt] = strToU8(c.curt);
			if (mode === 'both') entries[`AI-Conversations/${c.files.md}`] = strToU8(c.markdown);
		}
		const d = new Date();
		const p = (n: number): string => String(n).padStart(2, '0');
		const name = mode === 'both' ? `curt-porter-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.zip` : `curt-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.zip`;
		downloadBlob(name, zipSync(entries), 'application/zip');
	}

	private render(): void {
		const { hero, success, successMeta, showBtn, curtisBtn, drop, paste, why, status, sources, listWrap, listCount, filter, actions, footerFolder } = this.el;
		const chats = allChats(this.reports);
		const mode = this.lastWrite ? 'success' : chats.length > 0 ? 'results' : 'empty';
		this.contentEl.toggleClass('porter-has-chats', mode === 'results');

		footerFolder.textContent = this.plugin.settings.outputFolder;

		// Confirmation state replaces the workspace.
		const isSuccess = mode === 'success';
		success.toggleClass('porter-hidden', !isSuccess);
		drop.toggleClass('porter-hidden', isSuccess);
		paste.toggleClass('porter-hidden', isSuccess);
		why.toggleClass('porter-hidden', isSuccess);
		status.toggleClass('porter-hidden', isSuccess);
		sources.toggleClass('porter-hidden', isSuccess);
		actions.toggleClass('porter-hidden', mode !== 'results');
		listWrap.toggleClass('porter-hidden', mode !== 'results');
		hero.toggleClass('porter-compact', mode !== 'empty');
		if (this.lastWrite) {
			const s = this.lastWrite.summary;
			const bits = [`${s.written} conversation${s.written === 1 ? '' : 's'} written to ${this.lastWrite.folder}`];
			if (s.curtWritten > 0) bits.push(`${s.curtWritten} .curt cop${s.curtWritten === 1 ? 'y' : 'ies'}`);
			if (s.skipped > 0) bits.push(`${s.skipped} already present (skipped)`);
			if (s.failed.length > 0) bits.push(`${s.failed.length} failed`);
			successMeta.setText(bits.join(' · '));
			showBtn.toggleClass('porter-hidden', !Platform.isDesktopApp);
			const curtis = (
				this.app as unknown as { plugins?: { plugins?: Record<string, { activateChatView?: () => void }> } }
			).plugins?.plugins?.['curtis-ai-chat'];
			curtisBtn.toggleClass('porter-hidden', !curtis?.activateChatView);
			return;
		}

		const problems: string[] = [];
		for (const r of this.reports) {
			const label = FORMAT_LABELS[r.format] ?? r.format;
			if (r.error && r.chats.length === 0) {
				problems.push(`Could not read ${r.file} (${label}). ${errorHint(r.file)}`);
			}
		}
		status.setText(problems.join(' '));

		sources.empty();
		for (const r of this.reports) {
			const label = FORMAT_LABELS[r.format] ?? r.format;
			const n = r.chats.length + r.skipped;
			const chip = sources.createDiv({ cls: 'porter-chip' });
			if (r.error && r.chats.length === 0) chip.addClass('porter-chip-err');
			chip.createSpan({ cls: 'porter-chip-name', text: r.file });
			chip.createSpan({ text: ` ${label} · ${n} chat${n === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} dup` : ''}` });
		}

		listCount.setText(`${chats.length} conversation${chats.length === 1 ? '' : 's'} found`);
		filter.toggleClass('porter-hidden', chats.length < 20);
		this.renderList();
	}

	/** Render the conversation rows (checkbox + presence chips + filter). */
	private renderList(): void {
		const { list } = this.el;
		const chats = allChats(this.reports);
		const needle = this.filter.trim().toLowerCase();
		list.empty();

		chats.forEach((c, i) => {
			if (needle && !c.conversation.title.toLowerCase().includes(needle)) return;
			const row = list.createDiv({ cls: 'porter-row' });
			const check = row.createEl('input', { type: 'checkbox' });
			check.checked = true;
			check.dataset.chat = String(i);
			const main = row.createDiv({ cls: 'porter-row-main' });
			main.createDiv({ cls: 'porter-row-title', text: c.conversation.title || 'Untitled' });
			const when = new Date(c.conversation.createdAt);
			const meta = [
				`${c.conversation.messages.length} messages`,
				Number.isFinite(when.getTime()) ? when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '',
				c.conversation.provider,
			]
				.filter(Boolean)
				.join(' · ');
			const metaEl = main.createDiv({ cls: 'porter-row-meta', text: meta });
			if (this.inVault(c)) {
				metaEl.createSpan({ cls: 'porter-already', text: 'already in vault' });
			}
		});
	}

	private inVault(c: ConvertedChat): boolean {
		if (!this.vaultKeys) return false;
		return this.vaultKeys.ids.has(c.conversation.id) || this.vaultKeys.keys.has(conversationDedupeKey({ ...c.conversation, id: '' }));
	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}
}
