// VENDORED REFERENCE — do not edit by hand.
//
// Verbatim copy of the .curt serializer/parser from curtis-ai-chat
// src/import/curt-format.ts (the plugin that owns the format; since v2.0.1
// the contract lives there, split from the Obsidian I/O in curt.ts). This
// snapshot is the porter's standalone contract oracle: `npm test` validates
// porter output against it without requiring the plugin repo. When the
// plugin's parser changes, re-copy it here and note the plugin version below.
//
// Source: curtis-ai-chat src/import/curt-format.ts @ v2.0.1 (1c7a19f, 2026-10-11)
// Differences from the original: curtZipEntryName (bulk-zip entry naming) is
// dropped — only the serialize/parse contract survives here. serializeCurt is
// kept because the contract suite round-trips through it.
// v2.0.0 (07ef857) added the optional `generator` provenance field to the
// envelope ("curtis-ai-chat@<version>"); parseCurt ignores it entirely —
// older files without it parse identically.

import type { Conversation, ConversationMessage } from '../../src/core/types';

const CURT_MAGIC = 'curtis-conversation';
const CURT_VERSION = 1;

interface CurtFile {
	curt: typeof CURT_MAGIC;
	version: number;
	/**
	 * Provenance: which app and version produced the file, formatted as
	 * "curtis-ai-chat@<version>". Optional — older first-party files and
	 * third-party writers omit it. Readers must ignore it for compatibility:
	 * its presence, absence, or value never affects parsing.
	 */
	generator?: string;
	conversation: Conversation;
}

function isMessage(v: unknown): v is ConversationMessage {
	if (!v || typeof v !== 'object') return false;
	const m = v as Record<string, unknown>;
	return (
		typeof m.id === 'string' &&
		(m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool') &&
		typeof m.content === 'string' &&
		typeof m.timestamp === 'number'
	);
}

/**
 * Serialize a conversation as a .curt file body. When `pluginVersion` is
 * given (callers pass `plugin.manifest.version`), the file is stamped with a
 * `generator` provenance field; without it the field is omitted entirely —
 * the version is never hardcoded.
 */
export function serializeCurt(conv: Conversation, pluginVersion?: string): string {
	const file = {
		curt: CURT_MAGIC,
		version: CURT_VERSION,
		conversation: conv,
		...(pluginVersion ? { generator: `curtis-ai-chat@${pluginVersion}` } : {}),
	};
	return JSON.stringify(file, null, '\t');
}

/**
 * Parse a .curt body. Returns null when the magic/version/shape doesn't
 * validate — callers report the file as failed rather than importing a
 * half-parsed conversation.
 */
export function parseCurt(raw: string): Conversation | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	const f = data as { curt?: string; version?: number; conversation?: Partial<Conversation> };
	if (f?.curt !== CURT_MAGIC || f?.version !== CURT_VERSION) return null;
	const conv = f.conversation;
	if (
		!conv ||
		typeof conv.id !== 'string' ||
		typeof conv.title !== 'string' ||
		typeof conv.createdAt !== 'number' ||
		typeof conv.updatedAt !== 'number' ||
		!Array.isArray(conv.messages) ||
		!conv.messages.every(isMessage)
	) {
		return null;
	}
	return conv as Conversation;
}
