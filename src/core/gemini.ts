// Gemini (Google) Takeout converter.
//
// The only official Gemini export is Google Takeout → "My Activity": a JSON
// list of activity items. Prompts arrive as items titled "Prompted …";
// Gemini's answers ride along in the item body when the export includes
// them (coverage has grown over time — some exports carry prompts only).
//
// Takeout has no conversation grouping, so turns are sorted by time and
// split into conversations at gaps longer than three hours. Conservative by
// design: prompts-only exports yield nothing (both sides are required) —
// those users fall back to the paste path, which always works.

import type { ParsedChat, ParsedMessage } from './types';
import { anyToMs } from './grok';

/** A conversation starts after this many hours of silence. */
const GAP_HOURS = 3;

interface ActivityItem {
	header?: string;
	title?: string;
	text?: string;
	time?: string | number;
	date?: string | number;
}

function itemTime(it: ActivityItem): number | undefined {
	return anyToMs(it.time ?? it.date);
}

export function parseGeminiTakeout(data: unknown): ParsedChat[] {
	const items = Array.isArray(data)
		? data
		: Array.isArray((data as { event?: unknown })?.event)
			? ((data as { event: unknown[] }).event)
			: null;
	if (!items) return [];

	const turns: ParsedMessage[] = [];
	for (const raw of items) {
		if (!raw || typeof raw !== 'object') continue;
		const it = raw as ActivityItem;
		const title = typeof it.title === 'string' ? it.title : '';
		const body = typeof it.text === 'string' ? it.text.trim() : '';
		const ts = itemTime(it);
		if (/^prompted[\s:]/i.test(title)) {
			const prompt = title.replace(/^prompted[\s:]*/i, '').replace(/\s*…$/, '').trim();
			if (prompt) turns.push({ role: 'user', content: prompt, timestamp: ts });
		} else if (body && !/^https?:\/\//i.test(body) && !/^prompted[\s:]/i.test(body)) {
			// Non-prompt activity body = Gemini's side of the exchange (when the
			// export includes it). Bare URLs are just links, not content.
			turns.push({ role: 'assistant', content: body, timestamp: ts });
		}
	}
	if (!turns.some((t) => t.role === 'user') || !turns.some((t) => t.role === 'assistant')) return [];
	turns.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

	const chats: ParsedChat[] = [];
	let current: ParsedMessage[] = [];
	const GAP_MS = GAP_HOURS * 60 * 60 * 1000;
	const flush = (): void => {
		if (current.length === 0) return;
		if (!current.some((m) => m.role === 'user') || !current.some((m) => m.role === 'assistant')) {
			current = [];
			return;
		}
		const firstUser = current.find((m) => m.role === 'user')!;
		chats.push({
			title: firstUser.content.slice(0, 60),
			messages: current,
			createdAt: current[0]?.timestamp,
			updatedAt: current[current.length - 1]?.timestamp,
			provider: 'gemini',
		});
		current = [];
	};
	for (const turn of turns) {
		const prev = current[current.length - 1];
		if (prev && prev.timestamp !== undefined && turn.timestamp !== undefined && turn.timestamp - prev.timestamp > GAP_MS) {
			flush();
		}
		current.push(turn);
	}
	flush();
	return chats;
}

/** Detection signature: Takeout activity items are titled "Prompted …". */
export function looksLikeGeminiTakeout(data: unknown): boolean {
	if (!Array.isArray(data)) return false;
	return data.some(
		(it) => !!it && typeof it === 'object' && typeof (it as ActivityItem).title === 'string' && /^prompted[\s:]/i.test((it as ActivityItem).title as string)
	);
}
