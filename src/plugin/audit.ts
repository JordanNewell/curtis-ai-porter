// Plugin-side audit reporting — the porter as a sender.
//
// Sender mode: after writeConversions lands chats, fire one
// window.curtisAudit.record() per chat. Fire-and-forget, graceful no-op when
// curtis-ai-audit isn't installed — presence is a courtesy, never a
// dependency (same rule as refreshCurtisViews).
//
// Backfill mode: file receipts for chats already sitting in the output
// folder. These go through the audit inbox (not record()) with stable
// per-conversation message ids, so re-running backfill dedupes on the ingest
// side instead of writing duplicate receipts.

import { Notice, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { ConvertedChat } from '../core/types';
import { AUDIT_AGENT, chatImportPayload, chatMessageId, encodeAuditBlock } from '../core/audit';
import { parseConversationMarkdown } from '../core/curtis-md';
import { markdownFilesIn } from './write';

interface CurtisAuditApi {
	record: (payload: Record<string, unknown>) => Promise<unknown>;
}

function auditApi(): CurtisAuditApi | null {
	const api = (window as unknown as { curtisAudit?: CurtisAuditApi }).curtisAudit;
	return api && typeof api.record === 'function' ? api : null;
}

/** Sender mode: one record() per chat written this run. Returns how many were filed. */
export function recordChatImports(app: App, folder: string, chats: ConvertedChat[]): number {
	const api = auditApi();
	if (!api) return 0;
	let filed = 0;
	for (const chat of chats) {
		const payload = chatImportPayload(chat.conversation, `${folder}/${chat.files.md}`);
		api.record(payload).catch((err: unknown) => {
			console.warn('[curtis-ai-porter] audit record failed', err);
		});
		filed++;
	}
	return filed;
}

interface AuditPluginHandle {
	settings?: { messengerRoot?: string; inboxAddress?: string };
}

function auditInboxPath(app: App): string | null {
	const audit = (app as unknown as { plugins?: { plugins?: Record<string, AuditPluginHandle> } }).plugins?.plugins?.[
		'curtis-ai-audit'
	];
	if (!audit) return null;
	const root = audit.settings?.messengerRoot?.trim() || 'Messenger';
	const address = audit.settings?.inboxAddress?.trim() || 'audit';
	return `${root}/${address}/inbox.md`;
}

async function appendToVaultFile(app: App, path: string, content: string): Promise<void> {
	const adapter = app.vault.adapter;
	try {
		await adapter.mkdir(path.split('/').slice(0, -1).join('/'));
	} catch {
		// exists
	}
	const withAppend = adapter as unknown as { append?: (p: string, data: string) => Promise<void> };
	if (typeof withAppend.append === 'function') {
		await withAppend.append(path, content);
		return;
	}
	// older API: atomic read-modify-write fallback
	const existing = await adapter.read(path).catch(() => '');
	await adapter.write(path, existing + content);
}

/** Backfill mode: one inbox block per conversation already in the output folder. */
export async function backfillAuditReceipts(
	app: App,
	folder: string
): Promise<{ ok: boolean; filed: number; total: number; reason?: string }> {
	const inboxPath = auditInboxPath(app);
	if (!inboxPath) {
		new Notice('Curtis AI Porter: install + enable curtis-ai-audit first — nothing to file receipts to', 8000);
		return { ok: false, filed: 0, total: 0, reason: 'curtis-ai-audit not installed' };
	}

	const seen = new Set<string>();
	let total = 0;
	const blocks: string[] = [];
	const folderNode = app.vault.getAbstractFileByPath(folder);
	if (!(folderNode instanceof TFolder)) {
		new Notice(`Curtis AI Porter: no conversations found in ${folder} — nothing to backfill`, 8000);
		return { ok: true, filed: 0, total: 0 };
	}
	for (const file of markdownFilesIn(folderNode)) {
		try {
			const conv = parseConversationMarkdown(await app.vault.read(file), file.stat.mtime);
			if (!conv || seen.has(conv.id)) continue;
			seen.add(conv.id);
			const payload = chatImportPayload(conv, file.path);
			blocks.push(encodeAuditBlock(chatMessageId(conv.id), payload));
			total++;
		} catch {
			// not ours / unreadable — skip
		}
	}
	if (total === 0) {
		new Notice(`Curtis AI Porter: no conversations found in ${folder} — nothing to backfill`, 8000);
		return { ok: true, filed: 0, total: 0 };
	}

	await appendToVaultFile(app, inboxPath, blocks.join(''));
	new Notice(
		`Curtis AI Porter: filed ${total} audit receipt(s) → ${inboxPath} (deduped on re-run by the ledger's ingest)`,
		8000
	);
	return { ok: true, filed: total, total };
}

export { AUDIT_AGENT };
