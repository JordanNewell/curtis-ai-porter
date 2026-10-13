// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Continuation pack — the flagship export: one markdown file per conversation
// that the user attaches to a fresh ChatGPT / Claude / Gemini chat to resume
// where they left off. Self-contained plain markdown: title, a provenance
// line, a one-paragraph instruction, then the transcript as `## You` /
// `## Assistant` turns. Long conversations are trimmed to a token budget
// (chars/4 estimate), always keeping the first user message plus as many of
// the most recent turns as fit, with a marker line standing in for what was
// cut. The preamble is tuned to the receiving platform via `target`.

import type { Conversation, ConversationMessage } from '../types';

export type ContinuationTarget = 'chatgpt' | 'claude' | 'gemini' | 'generic';

/** The generic preamble, kept verbatim for stable default output. */
const GENERIC_PREAMBLE =
	'The following is a transcript of a previous conversation between the user and an AI assistant. Read it, adopt its context, and continue seamlessly from the last message.';

const PREAMBLES: Record<ContinuationTarget, string> = {
	generic: GENERIC_PREAMBLE,
	chatgpt:
		'The following is a transcript of a previous ChatGPT conversation. Read it, adopt its context, and continue seamlessly in this ChatGPT chat from the last message.',
	claude:
		'The following is a transcript of a previous Claude conversation. Read it, adopt its context, and continue seamlessly in this Claude chat from the last message.',
	gemini:
		'The following is a transcript of a previous Gemini conversation. Read it, adopt its context, and continue seamlessly in this Gemini chat from the last message.',
};

const DEFAULT_BUDGET_TOKENS = 30000;

export interface ContinuationOptions {
	/** Approximate token budget for the transcript body (default 30000). */
	budgetTokens?: number;
	/** Receiving platform; picks the preamble (default generic, unknown → generic). */
	target?: ContinuationTarget;
	/** Provenance line under the title (default true). */
	provenance?: boolean;
}

export interface ContinuationInfo {
	target: ContinuationTarget;
	/** user+assistant turns in the conversation */
	turnsTotal: number;
	/** turns present in the pack (anchor included) */
	turnsKept: number;
	/** turnsTotal - turnsKept */
	turnsOmitted: number;
	/** rendered size of kept turns, same measure as the budget math */
	charsKept: number;
	/** effective budget used */
	budgetTokens: number;
}

interface Turn {
	heading: 'You' | 'Assistant';
	body: string;
	/** Rendered size of the turn (heading + body), for the chars/4 estimate. */
	chars: number;
}

function renderTurn(m: ConversationMessage): Turn | null {
	if (m.role !== 'user' && m.role !== 'assistant') return null;
	let body = m.content;
	if (m.images && m.images.length > 0) body += (body ? '\n\n' : '') + '_[image omitted]_';
	const heading = m.role === 'user' ? 'You' : 'Assistant';
	return { heading, body, chars: `## ${heading}\n\n${body}`.length };
}

function turnBlock(t: Turn): string {
	return `## ${t.heading}\n\n${t.body}`;
}

/** Local-time YYYY-MM-DD (local-first: dates follow the user's clock). */
function localDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * `_Resumed transcript: N turns, YYYY-MM-DD to YYYY-MM-DD, model._`
 * Dates span the conversation's user+assistant messages with finite
 * timestamps; clauses without data are dropped.
 */
function provenanceLine(turnsKept: number, conv: Conversation): string {
	const clauses = [`${turnsKept} turn${turnsKept === 1 ? '' : 's'}`];
	let first = Infinity;
	let last = -Infinity;
	for (const m of conv.messages) {
		if ((m.role !== 'user' && m.role !== 'assistant') || !Number.isFinite(m.timestamp)) continue;
		if (m.timestamp < first) first = m.timestamp;
		if (m.timestamp > last) last = m.timestamp;
	}
	if (first <= last) clauses.push(`${localDate(first)} to ${localDate(last)}`);
	const model = typeof conv.model === 'string' ? conv.model.trim() : '';
	if (model) clauses.push(model);
	return `_Resumed transcript: ${clauses.join(', ')}._`;
}

/**
 * Build the continuation pack plus the budget-accounting info behind it.
 * One walk selects what ships: the most recent contiguous run that fits the
 * budget, plus the first user message pinned ahead of the marker when the
 * run no longer covers it.
 */
export function buildContinuation(conv: Conversation, opts: ContinuationOptions = {}): { markdown: string; info: ContinuationInfo } {
	const target: ContinuationTarget = opts.target && PREAMBLES[opts.target] ? opts.target : 'generic';
	const budgetTokens = Math.max(1, opts.budgetTokens ?? DEFAULT_BUDGET_TOKENS);
	const budgetChars = budgetTokens * 4;
	const turns = conv.messages.map(renderTurn).filter((t): t is Turn => t !== null);
	const firstUserIdx = turns.findIndex((t) => t.heading === 'You');

	// Most recent contiguous run that fits the budget.
	let start = turns.length;
	let used = 0;
	for (let i = turns.length - 1; i >= 0; i--) {
		if (used + turns[i].chars > budgetChars) break;
		used += turns[i].chars;
		start = i;
	}

	// The first user message is the anchor: if the recent run already covers
	// it, it stays in place; otherwise it is pinned ahead of the marker.
	const anchorIdx = firstUserIdx >= 0 && firstUserIdx < start ? firstUserIdx : -1;
	const hidden = start - (anchorIdx >= 0 ? 1 : 0);

	// The pack body, in order: anchor, marker, recent run.
	const body: string[] = [];
	let charsKept = 0;
	if (anchorIdx >= 0) {
		body.push(turnBlock(turns[anchorIdx]));
		charsKept += turns[anchorIdx].chars;
	}
	if (hidden > 0) body.push(`_[… ${hidden} earlier turn${hidden === 1 ? '' : 's'} omitted for length …]_`);
	for (let i = start; i < turns.length; i++) {
		body.push(turnBlock(turns[i]));
		charsKept += turns[i].chars;
	}

	// Count kept turns off the rendered parts themselves, not a parallel tally.
	const turnsKept = body.filter((p) => p.startsWith('## ')).length;

	const parts: string[] = [`# ${conv.title}`];
	if (opts.provenance !== false) parts.push(provenanceLine(turnsKept, conv));
	parts.push(PREAMBLES[target]);
	parts.push(...body);
	return {
		markdown: parts.join('\n\n') + '\n',
		info: {
			target,
			turnsTotal: turns.length,
			turnsKept,
			turnsOmitted: turns.length - turnsKept,
			charsKept,
			budgetTokens,
		},
	};
}

/**
 * Serialize one conversation as an attachable continuation pack.
 * System/tool messages are skipped; images become `_[image omitted]_`.
 * Back-compat delegate for buildContinuation().markdown.
 */
export function serializeContinuationMarkdown(conv: Conversation, opts: ContinuationOptions = {}): string {
	return buildContinuation(conv, opts).markdown;
}
