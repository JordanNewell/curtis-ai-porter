// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// .curt — Curtis's branded single-file conversation format.
//
// The format rules (envelope, magic/version check, per-message guard,
// round-trip preservation, BOM tolerance) live in the canonical `curt-format`
// npm package (dot_curt); this module is a thin adapter that keeps the
// porter's public surface: serializeCurt's optional
// "curtis-ai-porter@<version>" generator stamp and sanitizeFilename, which
// are app-level conveniences, not format rules.
//
// Byte-identity contract (verify.ts): a .curt body written by serializeCurt
// re-serializes to identical bytes, because curt-format's serializeCurt
// builds the envelope in the same key order (curt, version, conversation,
// generator last) with the same tab-indented JSON.stringify. The pinned
// oracle in test/curtis-reference/parse-curt.ts guards this after the flip.
//
// Exports also stamp a `generator` field naming the app and version that
// wrote the file — provenance only. Readers ignore it entirely: first-party
// files written before the field existed and third-party writers without it
// import identically.

import {
	parseCurt as parseCurtFile,
	serializeCurt as serializeCurtFile,
} from 'curt-format';
import type { CurtConversation } from 'curt-format';
import type { Conversation } from './types';

export const CURT_FORMAT = { magic: 'curtis-conversation' as const, version: 1 };

export interface CurtFile {
	curt: 'curtis-conversation';
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
	return serializeCurtFile(conv as unknown as CurtConversation, generator);
}

/**
 * Parse a .curt body. Returns null when the magic/version/shape doesn't
 * validate — callers report the file as failed rather than importing a
 * half-parsed conversation. Delegates to curt-format, which also strips a
 * leading UTF-8 BOM per spec 1.1.0.
 */
export function parseCurt(raw: string): Conversation | null {
	return parseCurtFile(raw) as Conversation | null;
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
