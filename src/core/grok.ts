// Grok (x.ai) export converter.
//
// grok.com's data export ships a JSON archive whose `conversations` array
// holds one entry per chat, each with a nested `responses` array of turns
// (role + message). Shape per the export format documented by import-tool
// authors; the parser stays tolerant on field names (message/text/content,
// epoch seconds/milliseconds/ISO timestamps) because the export has drifted
// across versions.

import type { ParsedChat, ParsedMessage } from './types';

interface GrokConversation {
	title?: string;
	name?: string;
	createTime?: number | string;
	updateTime?: number | string;
	responses?: unknown[];
}

/** Epoch seconds / milliseconds / ISO string → epoch ms, when recognizable. */
export function anyToMs(v: unknown): number | undefined {
	if (typeof v === 'number' && Number.isFinite(v)) {
		return v > 1e12 ? v : v > 1e9 ? v * 1000 : undefined;
	}
	if (typeof v === 'string') {
		const t = Date.parse(v);
		return Number.isFinite(t) ? t : undefined;
	}
	return undefined;
}

function responseToMessage(r: unknown): ParsedMessage | null {
	if (!r || typeof r !== 'object') return null;
	const m = r as Record<string, unknown>;
	const rawRole = typeof m.role === 'string' ? m.role : typeof m.sender === 'string' ? m.sender : undefined;
	if (rawRole === 'system') return null; // platform prompts — dropped, same as the ChatGPT parser
	let role: ParsedMessage['role'];
	if (rawRole === 'user' || rawRole === 'human') role = 'user';
	else if (rawRole === 'assistant' || rawRole === 'bot' || rawRole === 'model' || rawRole === 'grok') role = 'assistant';
	else return null;
	const text = (typeof m.message === 'string' && m.message.trim() && m.message) ||
		(typeof m.text === 'string' && m.text.trim() && m.text) ||
		'';
	const content = (text || '').trim();
	if (!content) return null;
	const msg: ParsedMessage = { role, content, timestamp: anyToMs(m.createTime ?? m.time) };
	return msg;
}

export function parseGrokExport(data: unknown): ParsedChat[] {
	const list = Array.isArray(data) ? data : (data as { conversations?: unknown })?.conversations;
	if (!Array.isArray(list)) return [];

	const chats: ParsedChat[] = [];
	for (const raw of list) {
		if (!raw || typeof raw !== 'object' || !Array.isArray((raw as GrokConversation).responses)) continue;
		const conv = raw as GrokConversation;
		const messages: ParsedMessage[] = [];
		for (const r of conv.responses ?? []) {
			const msg = responseToMessage(r);
			if (msg) messages.push(msg);
		}
		if (messages.length === 0) continue;
		const title = typeof conv.title === 'string' && conv.title.trim() ? conv.title.trim() : typeof conv.name === 'string' && conv.name.trim() ? conv.name.trim() : 'Imported Grok chat';
		chats.push({
			title,
			messages,
			createdAt: anyToMs(conv.createTime) ?? messages[0]?.timestamp,
			updatedAt: anyToMs(conv.updateTime) ?? messages[messages.length - 1]?.timestamp,
			provider: 'grok',
		});
	}
	return chats;
}
