// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Round-trip verification for native Curtis formats — the "round-trip
// guarantee" made user-visible: a native file parses, and parse → serialize
// reproduces it byte-for-byte (the canonical form this porter and the plugin
// write). Verification only reports; it never repairs or normalizes, and it
// adds no format logic of its own — parse/serialize from curt.ts and
// curtis-md.ts are the sole arbiters of validity.

import type { Conversation } from './types';
import { parseCurt, serializeCurtAs, CURT_FORMAT } from './curt';
import { parseConversationMarkdown, serializeCurtisMarkdown } from './curtis-md';

export interface VerifyResult {
	format: 'curt' | 'curtis-md' | 'unknown';
	/** File parses as a native format at all. */
	ok: boolean;
	/** parse → serialize is byte-identical to the input (canonical form). */
	canonical: boolean;
	/** Human-readable problems found, terse, one per entry. Empty when ok && canonical. */
	issues: string[];
	/** Present when ok. */
	summary?: { id: string; title: string; messages: number; first?: number; last?: number };
}

/**
 * Verify a .curt body: parses, and its bytes are exactly what serializeCurt
 * writes. Byte-identity holds for files written by serializeCurt (JSON key
 * order is insertion order on both sides); anything reformatted by hand or
 * by another tool is valid but not canonical, and that is reported as such —
 * the comparison is raw string equality, never normalized. The `generator`
 * stamp is part of the canonical bytes and each first-party writer stamps
 * its own app@version, so verification reproduces the stamp the file itself
 * carries — a plugin-written file and a porter-written file both verify
 * canonical, and a foreign or reordered stamp reads as non-canonical.
 */
export function verifyCurt(raw: string): VerifyResult {
	const conv = parseCurt(raw);
	if (!conv) {
		const damaged = raw.includes(CURT_FORMAT.magic);
		return {
			format: damaged ? 'curt' : 'unknown',
			ok: false,
			canonical: false,
			issues: [
				damaged
					? '.curt magic present but the body fails validation — file is corrupt or hand-edited'
					: 'not a native Curtis format',
			],
		};
	}
	// parseCurt succeeded, so raw is valid JSON — read the envelope's stamp.
	const envelope = JSON.parse(raw) as { generator?: unknown };
	const generator = typeof envelope.generator === 'string' ? envelope.generator : undefined;
	const reserialized = serializeCurtAs(conv, generator);
	const canonical = reserialized === raw;
	const issues: string[] = [];
	if (!canonical) issues.push('valid but not byte-canonical — re-save to canonicalize');
	return { format: 'curt', ok: true, canonical, issues, summary: summarize(conv) };
}

/**
 * Verify a Curtis markdown transcript against the same bar: parses, bytes
 * match serializeCurtisMarkdown exactly, and re-parse(serialize(parse)) is
 * the same conversation. `fallbackMtime` only fills timestamps the file
 * omits — canonical files are mtime-independent, and missing-timestamp
 * fallbacks are surfaced as issues, not silently accepted.
 */
export function verifyCurtisMarkdown(raw: string, fallbackMtime: number): VerifyResult {
	const conv = parseConversationMarkdown(raw, fallbackMtime);
	if (!conv) {
		const damaged = raw.includes('curtis: conversation');
		return {
			format: damaged ? 'curtis-md' : 'unknown',
			ok: false,
			canonical: false,
			issues: [
				damaged
					? 'Curtis frontmatter present but the file fails validation — check the frontmatter and message markers'
					: 'not a native Curtis format',
			],
		};
	}
	const reserialized = serializeCurtisMarkdown(conv);
	const canonical = reserialized === raw;
	const issues: string[] = [];
	if (!canonical) issues.push('valid but not byte-canonical — re-save to canonicalize');
	// A timestamp the parser filled from fallbackMtime moves when the fallback
	// does; a real one in the file doesn't. Diffing two parses with shifted
	// fallbacks isolates the fallbacks without re-reading markers here.
	const shifted = parseConversationMarkdown(raw, fallbackMtime + 1);
	if (shifted) {
		for (let i = 0; i < conv.messages.length && i < shifted.messages.length; i++) {
			if (conv.messages[i].timestamp !== shifted.messages[i].timestamp) {
				issues.push(`message ${i + 1} has no timestamp — fell back to file mtime`);
			}
		}
	}
	const reparsed = parseConversationMarkdown(reserialized, fallbackMtime);
	if (!reparsed || canonicalJson(reparsed) !== canonicalJson(conv)) {
		issues.push('re-serialization does not re-parse to the same conversation');
	}
	return { format: 'curtis-md', ok: true, canonical, issues, summary: summarize(conv) };
}

function summarize(conv: Conversation): VerifyResult['summary'] {
	let first: number | undefined;
	let last: number | undefined;
	for (const m of conv.messages) {
		if (!Number.isFinite(m.timestamp)) continue;
		if (first === undefined || m.timestamp < first) first = m.timestamp;
		if (last === undefined || m.timestamp > last) last = m.timestamp;
	}
	return { id: conv.id, title: conv.title, messages: conv.messages.length, first, last };
}

// JSON with object keys sorted recursively: two parses are deep-equal
// exactly when their canonical JSON matches. undefined-valued slots are
// dropped on both sides alike — the parser leaves optional fields unset, so
// absence and explicit undefined are the same state here.
function canonicalJson(v: unknown): string {
	if (v === undefined) return 'null';
	if (v === null || typeof v !== 'object') return JSON.stringify(v);
	if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
	const o = v as Record<string, unknown>;
	const keys = Object.keys(o)
		.filter((k) => o[k] !== undefined)
		.sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
