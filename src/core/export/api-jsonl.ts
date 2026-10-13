// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// API JSONL emitter — the OpenAI / Anthropic request shape (and the close
// cousin Open WebUI-style importers read): one conversation per line,
// {"messages":[{"role":"user"|"assistant","content":"..."}]}. Only string
// content; a leading system message is kept, everything else system/tool
// stays out so the history is safe to re-send to a provider.

import type { Conversation } from '../types';

interface ApiMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

function apiMessages(conv: Conversation): ApiMessage[] {
	const out: ApiMessage[] = [];
	conv.messages.forEach((m, i) => {
		if (i === 0 && m.role === 'system') out.push({ role: 'system', content: m.content });
		else if (m.role === 'user' || m.role === 'assistant') out.push({ role: m.role, content: m.content });
	});
	return out;
}

/** One JSON object per line, one line per conversation, newline-terminated. */
export function serializeApiJsonl(conversations: Conversation[]): string {
	return conversations.map((conv) => JSON.stringify({ messages: apiMessages(conv) }) + '\n').join('');
}
