// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Curtis AI Porter — Obsidian plugin entry.
//
// A standalone suite tool: ports foreign AI-chat exports into the vault as
// Curtis markdown (+ .curt copies) without requiring the Curtis AI Chat
// plugin. When Curtis is installed and pointed at the same folder, the
// ported chats simply appear in its history — shared format, no coupling.

import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import { addIcon } from 'obsidian';
import { zipSync, strToU8 } from 'fflate';
import { PORTER_ICON_ID, PORTER_ICON_SVG } from './icons';
import { PorterView, PORTER_VIEW_TYPE } from './porter-view';
import { DEFAULT_SETTINGS, PorterSettingTab, type PorterSettings } from './settings';
import { convertFiles, allChats } from '../core/convert';
import { parseConversationMarkdown } from '../core/curtis-md';
import { serializeCurt, sanitizeFilename } from '../core/curt';
import { conversationDedupeKey } from '../core/detect';
import { downloadBlob, markdownFilesIn } from './write';
import { backfillAuditReceipts, recordChatImports } from './audit';

const PORTABLE_EXTENSIONS = ['zip', 'json', 'curt', 'md', 'txt'];

export default class PorterPlugin extends Plugin {
	settings!: PorterSettings;

	async onload(): Promise<void> {
		await this.loadSettings();
		addIcon(PORTER_ICON_ID, PORTER_ICON_SVG);

		this.registerView(PORTER_VIEW_TYPE, (leaf) => new PorterView(leaf, this));
		this.addRibbonIcon(PORTER_ICON_ID, 'Curtis AI Porter', () => void this.activatePorterView()).addClass('curtis-porter-ribbon');

		this.addCommand({
			id: 'open-porter',
			name: 'Open porter',
			callback: () => void this.activatePorterView(),
		});

		this.addCommand({
			id: 'port-files-into-vault',
			name: 'Port chats into this vault…',
			callback: () => this.openFilePicker(),
		});

		this.addCommand({
			id: 'export-curt-zip',
			name: 'Export ported chats as .curt (zip)',
			callback: () => void this.exportCurtZip(),
		});

		this.addCommand({
			id: 'backfill-audit',
			name: 'Backfill audit receipts for ported chats',
			callback: () => void backfillAuditReceipts(this.app, this.settings.outputFolder),
		});

		// Explorer context menu: port any candidate file straight into the vault.
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFile)) return;
				if (!PORTABLE_EXTENSIONS.includes(file.extension.toLowerCase())) return;
				menu.addItem((item) => {
					item
						.setTitle('Port into vault (Curtis AI Porter)')
						.setIcon(PORTER_ICON_ID)
						.onClick(() => void this.portFile(file));
				});
			})
		);

		this.addSettingTab(new PorterSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		// Stored data is untrusted (hand-edited data.json) — build field by
		// field, keeping a default whenever the type doesn't match. Adding a
		// setting later only means adding it to DEFAULT_SETTINGS.
		const data = (await this.loadData()) as Record<string, unknown> | null;
		const settings = { ...DEFAULT_SETTINGS };
		for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof PorterSettings)[]) {
			const value = data?.[key];
			if (typeof value === typeof DEFAULT_SETTINGS[key]) (settings as Record<string, unknown>)[key] = value;
		}
		this.settings = settings;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activatePorterView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(PORTER_VIEW_TYPE)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf('tab');
		await leaf.setViewState({ type: PORTER_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	/** OS file-picker flow (same shape as the web UI's picker). */
	private openFilePicker(): void {
		const input = activeDocument.body.createEl('input', { type: 'file' });
		input.multiple = true;
		input.accept = PORTABLE_EXTENSIONS.map((e) => '.' + e).join(',');
		this.registerDomEvent(input, 'change', () => {
			const files = Array.from(input.files ?? []);
			input.remove();
			if (files.length === 0) return;
			void (async () => {
				const inputs = [];
				for (const f of files) inputs.push({ name: f.name, buffer: await f.arrayBuffer() });
				await this.portInputs(inputs);
			})();
		});
		input.click();
	}

	/** Explorer context-menu flow for one vault file. */
	private async portFile(file: TFile): Promise<void> {
		const buffer = await this.app.vault.readBinary(file);
		// readBinary gives the whole ArrayBuffer — no pooled-Buffer slicing needed.
		await this.portInputs([{ name: file.name, buffer }]);
	}

	private async portInputs(inputs: { name: string; buffer: ArrayBuffer }[]): Promise<void> {
		const progress = new Notice('Curtis AI Porter: converting…', 0);
		try {
			const reports = convertFiles(inputs);
			const chats = allChats(reports);
			if (chats.length === 0) {
				const first = reports.find((r) => r.error)?.error;
				new Notice(first ? `Curtis AI Porter found nothing: ${first}` : 'Curtis AI Porter found no conversations', 8000);
				return;
			}
			const { writeConversions, refreshCurtisViews } = await import('./write');
			const { summary, writtenChats } = await writeConversions(this.app, this.settings.outputFolder, this.settings.saveCurt, chats);
			refreshCurtisViews(this.app);
			// Sender mode: one audit receipt per chat written. No-op without curtis-ai-audit.
			const audited = recordChatImports(this.app, this.settings.outputFolder, writtenChats);
			const bits = [`${summary.written} conversation${summary.written === 1 ? '' : 's'} → ${this.settings.outputFolder}`];
			if (summary.curtWritten > 0) bits.push(`${summary.curtWritten} .curt`);
			if (audited > 0) bits.push(`${audited} audit receipt${audited === 1 ? '' : 's'}`);
			if (summary.skipped > 0) bits.push(`${summary.skipped} already present`);
			if (summary.failed.length > 0) bits.push(`${summary.failed.length} failed`);
			new Notice(`Curtis AI Porter: ${bits.join(', ')}`, 8000);
		} catch (e) {
			new Notice(`Curtis AI Porter: ${e instanceof Error ? e.message : String(e)}`, 8000);
		} finally {
			progress.hide();
		}
	}

	/**
	 * Zip every conversation in the output folder — transcripts are parsed
	 * back and re-serialized as .curt, and any .curt files already on disk
	 * ride along verbatim.
	 */
	private async exportCurtZip(): Promise<void> {
		const folder = this.settings.outputFolder;
		const entries: Record<string, Uint8Array> = {};
		const keys = new Set<string>();
		let count = 0;

		// Scoped to the output folder's subtree — no whole-vault enumeration.
		const folderNode = this.app.vault.getAbstractFileByPath(folder);
		for (const file of folderNode instanceof TFolder ? markdownFilesIn(folderNode) : []) {
			try {
				const conv = parseConversationMarkdown(await this.app.vault.read(file), file.stat.mtime);
				if (!conv) continue;
				const key = conversationDedupeKey({ ...conv, id: '' });
				if (keys.has(key)) continue;
				keys.add(key);
				entries[`${sanitizeFilename(conv.title || 'conversation')} ${conv.id.slice(-6)}.curt`] = strToU8(serializeCurt(conv, this.manifest.version));
				count++;
			} catch {
				// not ours
			}
		}
		if (count === 0) {
			new Notice(`Curtis AI Porter: no conversations found in ${folder}`, 8000);
			return;
		}
		const d = new Date();
		const p = (n: number): string => String(n).padStart(2, '0');
		const name = `curtis-chats-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
		downloadBlob(name, zipSync(entries), 'application/zip');
	}
}
