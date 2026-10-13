// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// ChatGPT-export-shape emitter.
//
// Writes Curtis conversations back out as a ChatGPT-export-shaped
// `conversations.json` — the lingua franca that TypingMind and similar tools
// import. The shape is exactly what src/core/chatgpt.ts parses: an array of
// conversations, each with a `mapping` of message nodes. A linear chain (one
// parent, one child per node) is a legal tree and keeps the emission exact.
// Only user/assistant messages are emitted — that is all the importer keeps,
// so Curtis → ChatGPT shape → Curtis round-trips the visible conversation
// losslessly (title, order, contents, whole-second timestamps).

import type { Conversation, ConversationMessage } from '../types';

interface MessageNode {
	id: string;
	message: {
		id: string;
		author: { role: string };
		create_time: number;
		content: { content_type: 'text'; parts: string[] };
		metadata: Record<string, unknown>;
		recipient: 'all';
	};
	parent: string | null;
	children: string[];
}

/** Epoch ms → epoch seconds (the ChatGPT format carries whole seconds). */
function toSeconds(ms: number): number {
	return Math.round(ms / 1000);
}

function messageNode(m: ConversationMessage, key: string, parent: string | null, child: string | null): MessageNode {
	const metadata: Record<string, unknown> = {};
	if (m.role === 'assistant' && m.model) metadata.model_slug = m.model;
	return {
		id: key,
		message: {
			id: m.id || key,
			author: { role: m.role },
			create_time: toSeconds(m.timestamp),
			content: { content_type: 'text', parts: [m.content] },
			metadata,
			recipient: 'all',
		},
		parent,
		children: child ? [child] : [],
	};
}

/**
 * Serialize conversations as a ChatGPT-export-shaped conversations.json body.
 * System/tool messages are omitted: every reader of this shape drops them,
 * and omitting them here keeps the round-trip exact.
 */
export function serializeChatGptShape(conversations: Conversation[]): string {
	const exportArray = conversations.map((conv) => {
		const visible = conv.messages.filter((m) => m.role === 'user' || m.role === 'assistant');

		// Node keys reuse the message ids when present. Keys are mapping
		// identity — dedupe defensively so a malformed id can't merge nodes.
		const keys = visible.map((m, i) => m.id || `node-${i}`);
		const used = new Set<string>();
		for (let i = 0; i < keys.length; i++) {
			while (used.has(keys[i])) keys[i] = `${keys[i]}-${i}`;
			used.add(keys[i]);
		}

		const mapping: Record<string, unknown> = {
			root: { children: keys.length > 0 ? [keys[0]] : [] },
		};
		visible.forEach((m, i) => {
			// Insertion order is conversation order; the importer's stable
			// chronological sort preserves it for equal create_times.
			mapping[keys[i]] = messageNode(m, keys[i], i === 0 ? 'root' : keys[i - 1], i < keys.length - 1 ? keys[i + 1] : null);
		});

		return {
			title: conv.title,
			create_time: toSeconds(conv.createdAt),
			update_time: toSeconds(conv.updatedAt),
			conversation_id: conv.id,
			mapping,
		};
	});
	return JSON.stringify(exportArray, null, '\t');
}
