// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Audit receipts — the porter's reporting path to curtis-ai-audit.
//
// The porter is a sender in the OM-1 sense: after chats land in the vault it
// files one receipt per chat (action "chat-import"). Two delivery routes use
// the exact same receipt shape:
//   - plugin: window.curtisAudit.record() when curtis-ai-audit is installed
//   - CLI / backfill: an OM-1 block appended to the audit inbox, whose
//     stable per-conversation id makes re-runs dedupe instead of duplicating
//
// The encoder below is vendored from curtis-ai-audit's src/protocol.ts
// (OM-1 SPEC §2–§3) so the two stay byte-compatible — same discipline as the
// vendored Curtis conversation types. Change them together or let a contract
// test catch the drift.

export const AUDIT_AGENT = 'curtis-ai-porter';

/** Sorted-key, single-line JSON — mirrors curtis-ai-audit src/protocol.ts. */
export function canonicalJson(value: unknown, seen: Set<object> = new Set()): string {
	if (value === null) return 'null';
	switch (typeof value) {
		case 'string':
			return JSON.stringify(value);
		case 'number':
			if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
			return JSON.stringify(value);
		case 'boolean':
			return value ? 'true' : 'false';
		default:
			if (typeof value !== 'object') throw new Error('canonicalJson: unsupported value');
			break;
	}
	if (seen.has(value)) throw new Error('canonicalJson: circular structure');
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return `[${value.map((item) => canonicalJson(item === undefined ? null : item, seen)).join(',')}]`;
		}
		const parts: string[] = [];
		for (const key of Object.keys(value).sort()) {
			const item = (value as Record<string, unknown>)[key];
			if (item === undefined) continue;
			parts.push(`${JSON.stringify(key)}:${canonicalJson(item, seen)}`);
		}
		return `{${parts.join(',')}}`;
	} finally {
		seen.delete(value);
	}
}

/**
 * The envelope lives inside an HTML comment, so comment tokens in string
 * values would terminate it early. JSON unicode escapes parse back unchanged.
 */
export function escapeCommentTokens(json: string): string {
	return json.replace(/-->/g, '--\\u003e').replace(/<!--/g, '\\u003c!--');
}

/** Stable per-conversation message id: same chat → same id → ingest dedupes. */
export function chatMessageId(conversationId: string): string {
	let h = 5381;
	for (let i = 0; i < conversationId.length; i++) {
		h = ((h << 5) + h + conversationId.charCodeAt(i)) >>> 0;
	}
	return `msg_${h.toString(36)}${conversationId.length.toString(36)}`;
}

const isoOrNull = (epochMs: number | undefined): string | undefined => {
	if (epochMs === undefined || !Number.isFinite(epochMs)) return undefined;
	const iso = new Date(epochMs).toISOString();
	return iso;
};

/** The audit.v1 payload for one imported chat. Sender's claim: ts = the chat's own creation date. */
export function chatImportPayload(
	conv: { id: string; title: string; createdAt: number; provider: string; model: string; messages: unknown[] },
	mdPath: string
): {
	agent: string;
	action: 'chat-import';
	status: 'ok';
	subject: string;
	summary: string;
	ts?: string;
	detail: { provider: string; model: string; messageCount: number };
} {
	const summary = (conv.title || 'untitled conversation').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled conversation';
	const ts = isoOrNull(conv.createdAt);
	return {
		agent: AUDIT_AGENT,
		action: 'chat-import',
		status: 'ok',
		subject: mdPath,
		summary,
		...(ts ? { ts } : {}),
		detail: {
			provider: conv.provider || 'unknown',
			model: conv.model || 'unknown',
			messageCount: conv.messages.length,
		},
	};
}

/** One complete OM-1 block, ready to append to the audit inbox. */
export function encodeAuditBlock(msgId: string, payload: object): string {
	const envelope = escapeCommentTokens(
		canonicalJson({ id: msgId, from: AUDIT_AGENT, to: 'audit', ts: new Date().toISOString(), replyTo: null })
	);
	return `<!-- messenger: ${envelope} -->\n${canonicalJson(payload)}\n<!-- /messenger -->\n\n`;
}
