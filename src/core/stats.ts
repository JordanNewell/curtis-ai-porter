// Aggregate analytics over a set of conversations — the read-only summary the
// CLI and web page show for a corpus. Pure data-in/string-out like the rest of
// core: no fs, no DOM, no network. Foreign exports carry NaN/Infinity in
// token, cost and timestamp fields, so every number entering here passes a
// finite check; no aggregate below can emit NaN.

import type { Conversation } from './types';

export interface ConversationStats {
	conversations: number;
	messages: number;
	userMessages: number;
	assistantMessages: number;
	toolMessages: number;
	systemMessages: number;
	/** Whitespace-separated word count over user+assistant content. */
	words: number;
	/** Sums over messages where the field is present. reportedBy = messages carrying the field. */
	tokens: { prompt: number; completion: number; total: number; reportedBy: number };
	cost: { total: number; reportedBy: number };
	/** Earliest message timestamp / latest message timestamp (epoch ms); falls back to conversation createdAt/updatedAt; undefined when nothing finite exists. */
	firstActivity?: number;
	lastActivity?: number;
	/** Conversation counts. provider falls back to '' — skip empty keys. */
	byProvider: Record<string, number>;
	/** Assistant-message model when present, else the conversation's model; skip empty. */
	byModel: Record<string, number>;
	/** 'YYYY-MM' (from message timestamps, local time) → message count. */
	byMonth: Record<string, number>;
	/** Top 5 conversations by message count, descending; ties broken by id for determinism. */
	largest: Array<{ id: string; title: string; messages: number }>;
}

function finite(n: unknown): n is number {
	return typeof n === 'number' && Number.isFinite(n);
}

function countWords(content: unknown): number {
	if (typeof content !== 'string') return 0;
	const trimmed = content.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

function monthKey(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function bump(rec: Record<string, number>, key: string): void {
	rec[key] = (rec[key] ?? 0) + 1;
}

export function computeStats(conversations: Conversation[]): ConversationStats {
	const s: ConversationStats = {
		conversations: 0,
		messages: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolMessages: 0,
		systemMessages: 0,
		words: 0,
		tokens: { prompt: 0, completion: 0, total: 0, reportedBy: 0 },
		cost: { total: 0, reportedBy: 0 },
		byProvider: {},
		byModel: {},
		byMonth: {},
		largest: [],
	};
	let first: number | undefined;
	let last: number | undefined;
	for (const conv of conversations) {
		s.conversations++;
		s.messages += conv.messages.length;
		let sawMessageTimestamp = false;
		for (const m of conv.messages) {
			switch (m.role) {
				case 'user': s.userMessages++; break;
				case 'assistant': s.assistantMessages++; break;
				case 'tool': s.toolMessages++; break;
				case 'system': s.systemMessages++; break;
			}
			if (m.role === 'user' || m.role === 'assistant') s.words += countWords(m.content);
			if (finite(m.timestamp)) {
				sawMessageTimestamp = true;
				const ts = m.timestamp;
				if (first === undefined || ts < first) first = ts;
				if (last === undefined || ts > last) last = ts;
				bump(s.byMonth, monthKey(ts));
			}
			if (m.tokens) {
				s.tokens.reportedBy++;
				if (finite(m.tokens.promptTokens)) s.tokens.prompt += m.tokens.promptTokens;
				if (finite(m.tokens.completionTokens)) s.tokens.completion += m.tokens.completionTokens;
				if (finite(m.tokens.totalTokens)) s.tokens.total += m.tokens.totalTokens;
			}
			if (typeof m.cost === 'number') {
				s.cost.reportedBy++;
				if (finite(m.cost)) s.cost.total += m.cost;
			}
		}
		// A conversation with no usable message timestamps still sits somewhere on the timeline.
		if (!sawMessageTimestamp) {
			if (finite(conv.createdAt) && (first === undefined || conv.createdAt < first)) first = conv.createdAt;
			if (finite(conv.updatedAt) && (last === undefined || conv.updatedAt > last)) last = conv.updatedAt;
		}
		if (conv.provider) bump(s.byProvider, conv.provider);
		// Assistant messages carry the model in this data model; conversation.model is the fallback.
		const msgModel = conv.messages.find((m) => m.role === 'assistant' && m.model)?.model;
		const model = msgModel || conv.model;
		if (model) bump(s.byModel, model);
	}
	if (first !== undefined) s.firstActivity = first;
	if (last !== undefined) s.lastActivity = last;
	s.largest = conversations
		.map((c) => ({ id: c.id, title: c.title, messages: c.messages.length }))
		.sort((a, b) => b.messages - a.messages || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.slice(0, 5);
	return s;
}

function formatDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderPairs(pairs: Array<[string, string]>): string {
	const width = Math.max(...pairs.map(([k]) => k.length));
	return pairs.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join('\n');
}

function recordLines(rec: Record<string, number>): string {
	const keys = Object.keys(rec).sort();
	return keys.length ? renderPairs(keys.map((k) => [k, String(rec[k])])) : '(none)';
}

export function renderStatsText(s: ConversationStats): string {
	const lines: string[] = [];
	const section = (title: string, body: string): void => {
		lines.push('', title, '-'.repeat(title.length), body);
	};

	lines.push('Conversation stats', '='.repeat('Conversation stats'.length));

	const when = (ms: number | undefined): string => (ms === undefined ? 'unknown' : formatDate(ms));
	const avg = s.conversations > 0 ? s.messages / s.conversations : 0;
	section('Overview', renderPairs([
		['Conversations', String(s.conversations)],
		['Messages', String(s.messages)],
		['Words', String(s.words)],
		['Avg messages/conv', avg.toFixed(1)],
		['Span', `${when(s.firstActivity)}..${when(s.lastActivity)}`],
	]));

	section('Tokens', renderPairs([
		['Prompt', String(s.tokens.prompt)],
		['Completion', String(s.tokens.completion)],
		['Total', String(s.tokens.total)],
		['Reported by', `${s.tokens.reportedBy} messages`],
	]));

	section('Cost', renderPairs([
		['Total', s.cost.total.toFixed(4)],
		['Reported by', `${s.cost.reportedBy} messages`],
	]));

	section('Providers', recordLines(s.byProvider));
	section('Models', recordLines(s.byModel));
	section('Activity by month', recordLines(s.byMonth));

	const largest = s.largest.length
		? s.largest.map((c, i) => `${i + 1}. ${c.title} (${c.messages} messages)`).join('\n')
		: '(none)';
	section('Largest conversations', largest);

	return lines.join('\n');
}
