// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Vault writing — turn converted conversations into vault files.
//
// Standalone by design: the porter never imports the Curtis plugin's code.
// It writes plain markdown transcripts into the output folder; when Curtis
// AI Chat happens to be installed on that folder, the files simply appear in
// its chat history because the format is the same. Cross-run dedupe keys
// match the plugin's own importer semantics (title + count + first user
// message), so re-porting an export is idempotent.

import { Notice, normalizePath, TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { ConvertedChat } from '../core/types';
import { conversationDedupeKey } from '../core/detect';
import { parseConversationMarkdown } from '../core/curtis-md';
import { sanitizeFilename } from '../core/curt';

export interface WriteSummary {
	written: number;
	skipped: number;
	curtWritten: number;
	/** Files that could not be written, as "<name> — <reason>". */
	failed: string[];
}

/** Markdown files under one folder, recursive — a scoped walk instead of
 *  enumerating every file in the vault: this touches only the output
 *  folder's subtree. */
export function markdownFilesIn(folder: TFolder): TFile[] {
	const found: TFile[] = [];
	const visit = (f: TFolder): void => {
		for (const child of f.children) {
			if (child instanceof TFile && child.extension === 'md') found.push(child);
			else if (child instanceof TFolder) visit(child);
		}
	};
	visit(folder);
	return found;
}

/** Collect dedupe keys for conversations already in the output folder. */
export async function scanVaultKeys(
	app: App,
	folder: string
): Promise<{ ids: Set<string>; keys: Set<string> }> {
	const ids = new Set<string>();
	const keys = new Set<string>();
	const abstract = app.vault.getAbstractFileByPath(folder);
	if (abstract instanceof TFolder) {
		for (const file of markdownFilesIn(abstract)) {
			try {
				const conv = parseConversationMarkdown(await app.vault.read(file), file.stat.mtime);
				if (!conv) continue;
				ids.add(conv.id);
				keys.add(conversationDedupeKey({ ...conv, id: '' }));
			} catch {
				// unreadable note in the folder — not ours to judge
			}
		}
	}
	return { ids, keys };
}

export async function ensureFolder(app: App, folder: string): Promise<void> {
	const parts = normalizePath(folder).split('/').filter(Boolean);
	let acc = '';
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) {
			try {
				await app.vault.createFolder(acc);
			} catch {
				// already exists / raced
			}
		}
	}
}

/**
 * Write converted chats into the vault. Returns per-file basenames it wrote
 * (and skipped count) for reporting.
 */
export async function writeConversions(
	app: App,
	folder: string,
	saveCurt: boolean,
	chats: ConvertedChat[]
): Promise<{ summary: WriteSummary; names: string[]; writtenChats: ConvertedChat[] }> {
	await ensureFolder(app, folder);
	const { ids, keys } = await scanVaultKeys(app, folder);

	const summary: WriteSummary = { written: 0, skipped: 0, curtWritten: 0, failed: [] };
	const names: string[] = [];
	const writtenChats: ConvertedChat[] = [];

	for (const chat of chats) {
		const conv = chat.conversation;
		if (ids.has(conv.id) || keys.has(conversationDedupeKey({ ...conv, id: '' }))) {
			summary.skipped++;
			continue;
		}
		const mdPath = normalizePath(`${folder}/${chat.files.md}`);
		if (app.vault.getAbstractFileByPath(mdPath)) {
			summary.skipped++;
			continue;
		}
		try {
			await app.vault.create(mdPath, chat.markdown);
		} catch (e) {
			if (/already exists/i.test((e as Error).message ?? '')) {
				summary.skipped++; // raced with another porter — same outcome
			} else {
				summary.failed.push(`${chat.files.md} — ${(e as Error).message ?? 'write failed'}`);
			}
			continue;
		}
		names.push(chat.files.md);
		summary.written++;
		writtenChats.push(chat);
		ids.add(conv.id);
		keys.add(conversationDedupeKey({ ...conv, id: '' }));

		if (saveCurt) {
			const curtPath = normalizePath(`${folder}/${chat.files.curt}`);
			if (!app.vault.getAbstractFileByPath(curtPath)) {
				try {
					await app.vault.create(curtPath, chat.curt);
					summary.curtWritten++;
				} catch (e) {
					if (!/already exists/i.test((e as Error).message ?? '')) {
						summary.failed.push(`${chat.files.curt} — ${(e as Error).message ?? 'write failed'}`);
					}
					// already-exists: the copy is there (race won by someone else)
					else summary.curtWritten++;
				}
			}
		}
	}
	return { summary, names, writtenChats };
}

/** Best-effort nudge to the Curtis plugin when it's installed alongside. */
export function refreshCurtisViews(app: App): void {
	const curtis = (app as unknown as { plugins?: { plugins?: Record<string, { refreshChatViews?: () => void }> } }).plugins?.plugins?.[
		'curtis-ai-chat'
	];
	try {
		curtis?.refreshChatViews?.();
	} catch {
		// presence is a courtesy, never a dependency
	}
}

/** Sanitize helper re-exported for filename display in the view. */
export { sanitizeFilename };

/** Trigger a browser download (zip export) from the plugin context. */
export function downloadBlob(name: string, data: BlobPart, type: string): void {
	const url = URL.createObjectURL(new Blob([data], { type }));
	const a = document.body.createEl('a', { attr: { href: url, download: name } });
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
	new Notice(`Downloaded ${name}`);
}
