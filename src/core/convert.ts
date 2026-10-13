// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// High-level conversion: input files in, .curt + Curtis-markdown out.
// The one entry point shared by the CLI and the web UI. Pure — no fs, no
// DOM — so the same code runs in Node and the browser.

import type { ConvertedChat, Conversation, ConversionReport } from './types';
import { detectAndParse, parsedChatToConversation, conversationDedupeKey } from './detect';
import { serializeCurt, sanitizeFilename } from './curt';
import { serializeCurtisMarkdown, vaultFileNameFor } from './curtis-md';
import { assignIds } from './ids';

export interface ConvertInput {
	name: string;
	buffer: ArrayBuffer;
}

export interface ConvertOptions {
	/** Emit Curtis markdown transcripts alongside .curt (default: true). */
	markdown?: boolean;
	/** Stamp .curt output with `generator: curtis-ai-porter@<version>`
	 *  provenance when given (readers ignore the field). */
	generatorVersion?: string;
}

/**
 * Convert input files. Dedupes across the whole run with the same key the
 * plugin's importer uses (title + message count + first user message), so
 * re-running an export never doubles conversations. .curt / Curtis-markdown
 * inputs round-trip verbatim (ids, tokens, images intact); foreign formats
 * get fresh Curtis-convention ids.
 */
export function convertFiles(files: ConvertInput[], opts: ConvertOptions = {}): ConversionReport[] {
	const markdown = opts.markdown ?? true;
	const generatorVersion = opts.generatorVersion;
	const seenIds = new Set<string>();
	const seenKeys = new Set<string>();
	// Output names are first-come-first-served across the WHOLE run: two input
	// files can carry same-titled chats, and a per-file check would let the
	// later one silently overwrite the earlier (writeFileSync and zip maps
	// both key on the bare name).
	const usedNames = new Set<string>();
	const reports: ConversionReport[] = [];

	for (const file of files) {
		const report: ConversionReport = { file: file.name, format: 'unknown', chats: [], skipped: 0 };
		reports.push(report);
		if (file.buffer.byteLength === 0) {
			report.error = 'empty file';
			continue;
		}
		let detected;
		try {
			detected = detectAndParse(file.name, file.buffer);
		} catch (e) {
			report.error = (e as Error).message || 'parse failure';
			continue;
		}
		report.format = detected.format;
		if (detected.format === 'unknown' || (detected.chats.length === 0 && !detected.conversations)) {
			report.error = 'no conversations recognized';
			continue;
		}

		// .curt / Curtis markdown round-trip full Conversation objects; foreign
		// formats normalize into fresh ones.
		const candidates: Conversation[] = detected.conversations ?? detected.chats.map(parsedChatToConversation);

		for (const conv of candidates) {
			const isRoundTrip = detected.format === 'curt' || detected.format === 'curtis-md';
			if (!isRoundTrip) assignIds(conv);

			const idKey = conv.id;
			const dupeKey = conversationDedupeKey({ ...conv, id: '' });
			if ((idKey && seenIds.has(idKey)) || seenKeys.has(dupeKey)) {
				report.skipped++;
				continue;
			}
			seenIds.add(idKey);
			seenKeys.add(dupeKey);

			report.chats.push(buildConverted(conv, markdown, generatorVersion, usedNames));
		}
	}
	return reports;
}

/** Generate output bodies + filenames for one conversation. */
function buildConverted(conv: Conversation, markdown: boolean, generatorVersion: string | undefined, usedNames: Set<string>): ConvertedChat {
	// The id6 disambiguator lands in filenames — sanitize crafted ids like "a_b/c".
	const short = sanitizeFilename(conv.id.split('_').pop()?.slice(-6) || conv.id.slice(-6));
	return {
		conversation: conv,
		curt: serializeCurt(conv, generatorVersion),
		markdown: markdown ? serializeCurtisMarkdown(conv) : '',
		files: {
			// .curt filenames carry no id suffix (matching the plugin's export), so
			// same-titled chats would collide — both names disambiguate run-wide.
			curt: uniqueName(`${sanitizeFilename(conv.title || 'conversation')}.curt`, short, usedNames),
			md: uniqueName(vaultFileNameFor(conv), short, usedNames),
		},
	};
}

/**
 * First taker keeps the bare name (byte-identical to single-chat output);
 * later clashes get the id6 suffix, then a counter if even that collides.
 */
function uniqueName(name: string, short: string, used: Set<string>): string {
	if (!used.has(name)) {
		used.add(name);
		return name;
	}
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	let candidate = `${stem} ${short}${ext}`;
	for (let n = 2; used.has(candidate); n++) candidate = `${stem} ${short} ${n}${ext}`;
	used.add(candidate);
	return candidate;
}

/** Flatten reports into every converted conversation, in order. */
export function allChats(reports: ConversionReport[]): ConvertedChat[] {
	return reports.flatMap((r) => r.chats);
}
