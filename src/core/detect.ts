// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Export-format auto-detection.
// Mirrors curtis-ai-chat src/import/detect.ts, extended with Grok and
// Gemini Takeout (the porter's broader provider coverage — see AGENTS.md).
//
// Order matters: extension-based (.curt, .zip) first, then structural JSON
// signatures (official exports before generic shapes), then the Curtis
// markdown frontmatter, then generic markdown — and generic only when both
// sides of a conversation are confidently found.

import { unzipSync, strFromU8 } from 'fflate';
import type { Conversation } from './types';
import type { DetectedFile, ParsedChat } from './types';
import { parseChatGptExport } from './chatgpt';
import { parseClaudeExport } from './claude';
import { parseGrokExport } from './grok';
import { parseGeminiTakeout, looksLikeGeminiTakeout } from './gemini';
import { parseCurt } from './curt';
import { parseGenericJsonAll, parseGenericMarkdown } from './generic';
import { parseConversationMarkdown } from './curtis-md';

/**
 * Structural JSON detection. Official export signatures first (Claude's
 * chat_messages, ChatGPT's mapping, Grok's responses, Gemini's Prompted
 * activity items), then the generic transcript net.
 */
function detectJson(data: unknown): DetectedFile {
	if (Array.isArray(data)) {
		if (data.some((c) => c && typeof c === 'object' && 'chat_messages' in c)) {
			return { format: 'claude', chats: parseClaudeExport(data) };
		}
		if (data.some((c) => c && typeof c === 'object' && 'mapping' in c)) {
			return { format: 'chatgpt', chats: parseChatGptExport(data) };
		}
		if (data.some((c) => c && typeof c === 'object' && 'responses' in c)) {
			const chats = parseGrokExport(data);
			if (chats.length > 0) return { format: 'grok', chats };
		}
		if (looksLikeGeminiTakeout(data)) {
			const chats = parseGeminiTakeout(data);
			if (chats.length > 0) return { format: 'gemini', chats };
		}
		return { format: 'generic-json', chats: parseGenericJsonAll(data) };
	}
	if (data && typeof data === 'object') {
		if ('mapping' in data) return { format: 'chatgpt', chats: parseChatGptExport(data) };
		if ('chat_messages' in data) return { format: 'claude', chats: parseClaudeExport(data) };
		if ('conversations' in data || 'responses' in data) {
			const chats = parseGrokExport(data);
			if (chats.length > 0) return { format: 'grok', chats };
		}
		const chats = parseGeminiTakeout(data);
		if (chats.length > 0) return { format: 'gemini', chats };
		return { format: 'generic-json', chats: parseGenericJsonAll(data) };
	}
	return { format: 'generic-json', chats: [] };
}

/**
 * Detect a ChatGPT/Claude export inside an arbitrary zip: the canonical
 * `conversations.json` (any folder depth), else any .json whose parsed
 * content carries a known signature, else .curt files (a bulk-export zip).
 * Non-chat zips yield 'unknown'.
 */
function detectZip(buf: Uint8Array): DetectedFile {
	// Refuse archives whose central directory is absent, malformed, or claims
	// more than we are willing to decompress (see zipPreflightOk).
	if (!zipPreflightOk(buf)) return { format: 'unknown', chats: [] };
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(buf);
	} catch {
		return { format: 'unknown', chats: [] };
	}
	const canonical = Object.keys(entries).find((p) => p === 'conversations.json' || p.endsWith('/conversations.json'));
	const candidates = canonical ? [canonical] : Object.keys(entries).filter((p) => p.toLowerCase().endsWith('.json'));
	for (const path of candidates) {
		let data: unknown;
		try {
			data = JSON.parse(strFromU8(entries[path]));
		} catch {
			continue;
		}
		const detected = detectJson(data);
		if (detected.chats.length > 0) return detected;
	}
	// A zip of .curt files (bulk export from the plugin or this porter) —
	// import every valid one; corrupted entries are skipped, not fatal.
	const curtEntries = Object.keys(entries).filter((p) => p.toLowerCase().endsWith('.curt'));
	if (curtEntries.length > 0) {
		const conversations: Conversation[] = [];
		for (const path of curtEntries) {
			const conv = parseCurt(strFromU8(entries[path]));
			if (conv) conversations.push(conv);
		}
		if (conversations.length > 0) return { format: 'curt', chats: [], conversations };
	}
	return { format: 'unknown', chats: [] };
}

// Decompression bounds: unzipSync is unbounded, and an OOM kill is uncatchable,
// so preflight the central directory (PK\x05\x06 EOCD → PK\x01\x02 entries) and
// refuse anything beyond these limits. ZIP64 is treated as over-limit.
const ZIP_MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1 GB
const ZIP_MAX_ENTRIES = 10000;

/** true when the central directory parses and stays within the bounds above. */
function zipPreflightOk(buf: Uint8Array): boolean {
	// Locate the EOCD record: fixed 22-byte tail + up to 65535 comment bytes.
	const scanFloor = Math.max(0, buf.length - 22 - 65535);
	let eocd = -1;
	for (let i = buf.length - 22; i >= scanFloor; i--) {
		if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) return false;
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const entryCount = dv.getUint16(eocd + 10, true);
	if (entryCount > ZIP_MAX_ENTRIES) return false;
	let pos = dv.getUint32(eocd + 16, true);
	const cdEnd = pos + dv.getUint32(eocd + 12, true);
	if (cdEnd > buf.byteLength) return false; // malformed or ZIP64 offsets
	let total = 0;
	for (let i = 0; i < entryCount; i++) {
		if (pos + 46 > cdEnd || dv.getUint32(pos, true) !== 0x02014b50) return false;
		const uncompressed = dv.getUint32(pos + 24, true);
		if (uncompressed === 0xffffffff) return false; // ZIP64 size marker
		total += uncompressed;
		if (total > ZIP_MAX_TOTAL_UNCOMPRESSED) return false;
		pos += 46 + dv.getUint16(pos + 28, true) + dv.getUint16(pos + 30, true) + dv.getUint16(pos + 32, true);
	}
	return true;
}

/** Decode export bytes as text, sniffing UTF-16 BOMs first (PowerShell's
 *  Out-File on Windows writes UTF-16, which mojibakes under a UTF-8 decoder).
 *  Valid UTF-8 input is unaffected. */
function decodeText(bytes: Uint8Array): string {
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
	return new TextDecoder().decode(bytes);
}

/**
 * Detect the format of one picked/dropped file and parse it.
 * `name` is only used for the .curt/.zip extensions and error reporting;
 * content signatures decide everything else.
 */
export function detectAndParse(name: string, buf: ArrayBuffer): DetectedFile {
	const ext = name.toLowerCase().split('.').pop() || '';
	const bytes = new Uint8Array(buf);

	if (ext === 'curt') {
		const conv = parseCurt(new TextDecoder().decode(bytes));
		return conv ? { format: 'curt', chats: [], conversations: [conv] } : { format: 'unknown', chats: [] };
	}

	if (ext === 'zip' || (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
		return detectZip(bytes);
	}

	const text = decodeText(bytes);

	// JSON documents (ChatGPT / Claude / Grok / Gemini / generic transcripts).
	const trimmed = text.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const data: unknown = JSON.parse(trimmed);
			return detectJson(data);
		} catch {
			return { format: 'unknown', chats: [] };
		}
	}

	// Curtis markdown (a transcript exported from another vault, or a vault
	// file copied by hand) — the store's parser owns that contract.
	const curtisMd = parseConversationMarkdown(text, 0);
	if (curtisMd) return { format: 'curtis-md', chats: [], conversations: [curtisMd] };

	// Generic role-headed markdown.
	const generic = parseGenericMarkdown(text);
	if (generic) return { format: 'generic-md', chats: [generic] };

	return { format: 'unknown', chats: [] };
}

/** A finite epoch-ms value, or undefined — NaN/Infinity pass `??` untouched,
 *  so every export-supplied timestamp goes through this guard. */
function finiteMs(n: number | undefined): number | undefined {
	return n !== undefined && Number.isFinite(n) ? n : undefined;
}

/** Normalize a parsed chat into a Conversation ready for id assignment.
 *  Tool-role messages are dropped: foreign transcripts carry no tool_calls
 *  linkage, and an orphan tool message would make providers reject the
 *  request when the imported history is re-sent on continuation. */
export function parsedChatToConversation(chat: ParsedChat): Conversation {
	const now = Date.now();
	const first = chat.messages[0]?.timestamp;
	const last = chat.messages[chat.messages.length - 1]?.timestamp;
	const createdAt = finiteMs(chat.createdAt) ?? finiteMs(first) ?? now;
	const updatedAt = finiteMs(chat.updatedAt) ?? finiteMs(last) ?? createdAt;
	return {
		id: '',
		title: chat.title,
		messages: chat.messages
			.filter((m) => m.role !== 'tool')
			.map((m) => ({
				id: '',
				role: m.role,
				content: m.content,
				timestamp: finiteMs(m.timestamp) ?? createdAt,
				model: m.model,
			})),
		createdAt: Math.min(createdAt, updatedAt),
		updatedAt: Math.max(createdAt, updatedAt),
		provider: chat.provider ?? '',
		model: chat.model ?? '',
	};
}

export function conversationDedupeKey(conv: Conversation): string {
	const first = conv.messages.find((m) => m.role === 'user')?.content ?? '';
	return `${conv.title.trim().toLowerCase()}|${conv.messages.length}|${first.slice(0, 200)}`;
}
