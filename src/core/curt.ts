// .curt — Curtis's branded single-file conversation format.
//
// Mirrors curtis-ai-chat src/import/curt-format.ts (minus Obsidian surfaces)
// — since plugin v2.0.1 the serialize/parse contract lives there, split from
// the Obsidian I/O layer in src/import/curt.ts. One .curt file = one
// conversation, serialized as JSON with a magic field. JSON (rather than the
// markdown+marker layout) because a portable file must be byte-robust: no
// marker-escaping edge cases, and base64 images / tool calls survive
// verbatim. Parsing validates strictly — a hand-corrupted file is reported,
// not guessed.
//
// Exports also stamp a `generator` field naming the app and version that
// wrote the file — provenance only. Readers ignore it entirely: first-party
// files written before the field existed and third-party writers without it
// import identically.

import type { Conversation, ConversationMessage } from './types';

const CURT_MAGIC = 'curtis-conversation';
const CURT_VERSION = 1;

export const CURT_FORMAT = { magic: CURT_MAGIC, version: CURT_VERSION };

export interface CurtFile {
	curt: typeof CURT_MAGIC;
	version: number;
	/**
	 * Provenance: which app and version produced the file, formatted as
	 * "<app>@<version>" (the plugin stamps "curtis-ai-chat@<version>", the
	 * porter "curtis-ai-porter@<version>"). Optional — older first-party
	 * files and third-party writers omit it. Readers must ignore it for
	 * compatibility: its presence, absence, or value never affects parsing.
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
 * Serialize a conversation as a .curt file body. When `generatorVersion` is
 * given, the file is stamped with a `generator` provenance field; without it
 * the field is omitted entirely — the version is never hardcoded.
 */
export function serializeCurt(conv: Conversation, generatorVersion?: string): string {
	return serializeCurtAs(conv, generatorVersion ? `curtis-ai-porter@${generatorVersion}` : undefined);
}

/**
 * Serialize with an explicit generator string, verbatim — no app prefix, no
 * version formatting, assigned after the base object so it serializes last.
 * `serializeCurt` builds on this; `verify` uses it to reproduce the stamp a
 * parsed file already carries, so either first-party writer's canonical
 * output verifies canonical.
 */
export function serializeCurtAs(conv: Conversation, generator?: string): string {
	const file: CurtFile = { curt: CURT_MAGIC, version: CURT_VERSION, conversation: conv };
	if (generator) file.generator = generator;
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
	const f = data as Partial<CurtFile>;
	if (!f || f.curt !== CURT_MAGIC || f.version !== CURT_VERSION) return null;
	const conv = f.conversation as Partial<Conversation> | undefined;
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

/**
 * Sanitize a title for a .curt filename (mirrors the plugin's export rules).
 * The 100-char cap, Windows reserved-device suffix and trailing-dot strip are
 * porter-side hardening on top of that rule — the import contract is untouched.
 */
export function sanitizeFilename(name: string): string {
	let out = name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim();
	if (out.length > 100) out = out.slice(0, 100);
	// Windows silently drops trailing dots/spaces, so never emit them.
	out = out.replace(/[. ]+$/, '');
	// Reserved device names fail on Windows even with an extension.
	if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(out)) out += '_';
	return out || 'conversation';
}
