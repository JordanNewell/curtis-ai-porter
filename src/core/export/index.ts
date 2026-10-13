// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Export dispatcher: Curtis conversations → other platforms' shapes.
// Pure string in / string out — no fs, no DOM — so the CLI, the web page and
// the plugin all reuse it. Import stays one-way additive: nothing here
// touches the detection or parsing paths.

import type { Conversation } from '../types';
import { sanitizeFilename } from '../curt';
import { serializeChatGptShape } from './chatgpt-shape';
import { serializeApiJsonl } from './api-jsonl';
import { serializeContinuationMarkdown, type ContinuationOptions } from './continuation-md';

export { serializeChatGptShape } from './chatgpt-shape';
export { serializeApiJsonl } from './api-jsonl';
export { serializeContinuationMarkdown } from './continuation-md';
export type { ContinuationOptions } from './continuation-md';

export type ExportTargetId = 'chatgpt-json' | 'api-jsonl' | 'continuation-md';

export interface ExportTarget {
	id: ExportTargetId;
	label: string;
	extension: string;
}

export const exportTargets: ExportTarget[] = [
	{ id: 'chatgpt-json', label: 'ChatGPT conversations.json', extension: 'json' },
	{ id: 'api-jsonl', label: 'API JSONL', extension: 'jsonl' },
	{ id: 'continuation-md', label: 'Continuation pack', extension: 'md' },
];

export interface ExportFile {
	/** Basename, ready to write or download. */
	name: string;
	body: string;
}

export interface ExportResult {
	files: ExportFile[];
}

export type ExportOptions = ContinuationOptions;

/**
 * Serialize conversations for one export target.
 *   chatgpt-json    → one combined conversations.json (always that name)
 *   api-jsonl       → one .jsonl; named for the conversation when there is
 *                     exactly one, conversations.jsonl when combining several
 *   continuation-md → one markdown pack per conversation,
 *                     `<title> (continuation).md` (same-titled chats
 *                     disambiguated with the id tail, like .curt files)
 */
export function serializeExport(target: ExportTargetId, conversations: Conversation[], opts: ExportOptions = {}): ExportResult {
	switch (target) {
		case 'chatgpt-json':
			return { files: [{ name: 'conversations.json', body: serializeChatGptShape(conversations) }] };

		case 'api-jsonl': {
			if (conversations.length === 0) return { files: [] };
			const name =
				conversations.length === 1
					? `${sanitizeFilename(conversations[0].title || 'conversation')}.jsonl`
					: 'conversations.jsonl';
			return { files: [{ name, body: serializeApiJsonl(conversations) }] };
		}

		case 'continuation-md': {
			const files: ExportFile[] = [];
			const seen = new Set<string>();
			for (const conv of conversations) {
				const base = `${sanitizeFilename(conv.title || 'conversation')} (continuation)`;
				let name = `${base}.md`;
				if (seen.has(name)) {
					const short = conv.id.split('_').pop()?.slice(-6) || conv.id.slice(-6);
					if (short) name = `${base} ${short}.md`;
				}
				let n = 2;
				while (seen.has(name)) name = `${base} ${n++}.md`;
				seen.add(name);
				files.push({ name, body: serializeContinuationMarkdown(conv, opts) });
			}
			return { files };
		}
	}
}
