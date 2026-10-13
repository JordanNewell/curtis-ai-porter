// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Continuation pack: target preambles, the provenance line, budget
// accounting via buildContinuation() info, and the back-compat delegate.
// Output-string behavior itself (budget walk, anchor, marker) is also
// covered in export.test.ts; here it is tied to the info numbers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildContinuation,
	serializeContinuationMarkdown,
	type ContinuationTarget,
} from '../src/core/export/continuation-md';
import type { Conversation, ConversationMessage, MessageRole } from '../src/core/types';

// ---- Fixtures ---------------------------------------------------------------

// The generic preamble as it has always been — pinned here verbatim so any
// accidental edit to the module constant fails this test.
const GENERIC_PREAMBLE =
	'The following is a transcript of a previous conversation between the user and an AI assistant. Read it, adopt its context, and continue seamlessly from the last message.';

function msg(id: string, role: MessageRole, content: string, timestamp: number, extra: Partial<ConversationMessage> = {}): ConversationMessage {
	return { id, role, content, timestamp, ...extra };
}

function conv(messages: ConversationMessage[], overrides: Partial<Conversation> = {}): Conversation {
	return {
		id: 'conv_1700000000000_testconv',
		title: 'Test chat',
		createdAt: 1700000000000,
		updatedAt: 1700000000000,
		provider: 'openai',
		model: 'gpt-4o',
		messages,
		...overrides,
	};
}

// Mirrors the pack's local-time rendering (spec: local-time YYYY-MM-DD); the
// regex assertions pin the format, this pins the actual dates.
function localDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rendered size of a turn, same formula as the pack's budget math. */
function turnChars(role: 'user' | 'assistant', body: string): number {
	return `## ${role === 'user' ? 'You' : 'Assistant'}\n\n${body}`.length;
}

const T0 = 1700000000000;

// ---- Default output: generic preamble + provenance line ---------------------

test('default: legacy preamble verbatim, provenance line between title and preamble', () => {
	const c = conv([msg('m1', 'user', 'hello', T0), msg('m2', 'assistant', 'hi there', T0 + 60000)]);
	const md = serializeContinuationMarkdown(c);
	const parts = md.split('\n\n');
	assert.equal(parts[0], '# Test chat');
	assert.equal(parts[1], `_Resumed transcript: 2 turns, ${localDate(T0)} to ${localDate(T0 + 60000)}, gpt-4o._`);
	assert.equal(parts[2], GENERIC_PREAMBLE);
	assert.ok(md.startsWith('# Test chat\n'));
	assert.ok(md.endsWith('hi there\n'));
});

test('provenance: turn count is the kept turns, singular/plural, dates from user+assistant stamps', () => {
	const c = conv([
		msg('m1', 'user', 'q', T0),
		msg('m2', 'assistant', 'a', T0 + 1000),
		msg('m3', 'system', 'skipped, not counted', T0 + 2000),
	]);
	const md = serializeContinuationMarkdown(c);
	assert.match(md, /^_Resumed transcript: 2 turns, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}, gpt-4o\._$/m);

	const one = conv([msg('m1', 'user', 'only', T0)]);
	assert.match(serializeContinuationMarkdown(one), /_Resumed transcript: 1 turn, /);

	// Non-finite stamps and system/tool messages contribute no date clause.
	const undated = conv([msg('m1', 'user', 'q', NaN), msg('m2', 'assistant', 'a', NaN)]);
	assert.ok(serializeContinuationMarkdown(undated).includes('_Resumed transcript: 2 turns, gpt-4o._'));

	// Empty model → no model clause.
	const noModel = conv([msg('m1', 'user', 'only', T0)], { model: '' });
	assert.match(serializeContinuationMarkdown(noModel), /_Resumed transcript: 1 turn, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\._$/m);
});

test('provenance: false drops the line; preamble follows the title directly', () => {
	const c = conv([msg('m1', 'user', 'hello', T0)]);
	const { markdown } = buildContinuation(c, { provenance: false });
	assert.ok(!markdown.includes('Resumed transcript'));
	assert.equal(markdown.split('\n\n')[1], GENERIC_PREAMBLE);
});

// ---- Target preambles ---------------------------------------------------------

test('target: each platform gets its own preamble, unknown/omitted fall back to generic', () => {
	const c = conv([msg('m1', 'user', 'hello', T0)]);
	const expected: Record<Exclude<ContinuationTarget, 'generic'>, string> = {
		chatgpt:
			'The following is a transcript of a previous ChatGPT conversation. Read it, adopt its context, and continue seamlessly in this ChatGPT chat from the last message.',
		claude:
			'The following is a transcript of a previous Claude conversation. Read it, adopt its context, and continue seamlessly in this Claude chat from the last message.',
		gemini:
			'The following is a transcript of a previous Gemini conversation. Read it, adopt its context, and continue seamlessly in this Gemini chat from the last message.',
	};
	for (const target of ['chatgpt', 'claude', 'gemini'] as const) {
		const { markdown, info } = buildContinuation(c, { target });
		assert.equal(markdown.split('\n\n')[2], expected[target], target);
		assert.equal(info.target, target);
	}
	// Omitted and unknown targets resolve to generic — preamble and info both.
	const omitted = buildContinuation(c);
	assert.equal(omitted.info.target, 'generic');
	assert.equal(omitted.markdown.split('\n\n')[2], GENERIC_PREAMBLE);
	const unknown = buildContinuation(c, { target: 'palm' as ContinuationTarget });
	assert.equal(unknown.info.target, 'generic');
	assert.equal(unknown.markdown.split('\n\n')[2], GENERIC_PREAMBLE);
});

// ---- Budget accounting ----------------------------------------------------------

// Six turns; rendered sizes: m0=13, m1=414, m2=408, m3=414, m4=408, m5=19.
function budgetConversation(): Conversation {
	return conv([
		msg('m0', 'user', 'FIRST', T0),
		msg('m1', 'assistant', 'A'.repeat(400), T0 + 1000),
		msg('m2', 'user', 'B'.repeat(400), T0 + 2000),
		msg('m3', 'assistant', 'C'.repeat(400), T0 + 3000),
		msg('m4', 'user', 'D'.repeat(400), T0 + 4000),
		msg('m5', 'assistant', 'FINAL', T0 + 5000),
	]);
}

test('budget cut: info matches the marker, anchor pinned, turnsKept = anchor + run', () => {
	const c = budgetConversation();
	// 30 tokens = 120 chars: only m5 (19 chars) fits the recent run.
	const { markdown, info } = buildContinuation(c, { budgetTokens: 30 });
	assert.equal(info.budgetTokens, 30);
	assert.equal(info.turnsTotal, 6);
	assert.equal(info.turnsKept, 2); // anchor (m0) + m5
	assert.equal(info.turnsOmitted, 4);
	assert.equal(info.charsKept, turnChars('user', 'FIRST') + turnChars('assistant', 'FINAL'));

	const marker = markdown.match(/_\[… (\d+) earlier turns? omitted for length …\]_/);
	assert.ok(marker, 'marker present');
	assert.equal(Number(marker![1]), info.turnsOmitted);
	// Anchor pinned ahead of the marker; recent run after it.
	assert.ok(markdown.indexOf('FIRST') < markdown.indexOf('omitted for length'));
	assert.ok(markdown.indexOf('omitted for length') < markdown.indexOf('FINAL'));
	assert.ok(!markdown.includes('AAAA')); // dropped turns really dropped
});

test('budget cut: singular marker, anchor counts toward kept, charsKept spans anchor + run', () => {
	const c = budgetConversation();
	// 400 tokens = 1600 chars: run m2..m5 (1249 chars), m1 breaks the walk.
	const { markdown, info } = buildContinuation(c, { budgetTokens: 400 });
	assert.equal(info.turnsKept, 5); // anchor (m0) + m2..m5
	assert.equal(info.turnsOmitted, 1);
	assert.equal(info.charsKept, turnChars('user', 'FIRST') + 408 + 414 + 408 + 19);
	assert.ok(markdown.includes('_[… 1 earlier turn omitted for length …]_'));
});

test('no cut: everything fits, no marker, omitted 0, anchor stays in place', () => {
	const c = budgetConversation();
	const { markdown, info } = buildContinuation(c);
	assert.equal(info.turnsOmitted, 0);
	assert.equal(info.turnsKept, 6);
	assert.equal(info.charsKept, 13 + 414 + 408 + 414 + 408 + 19);
	assert.ok(!markdown.includes('omitted for length'));
	// Conversation order intact: FIRST ahead of the rest, no duplicated anchor.
	assert.equal(markdown.indexOf('FIRST'), markdown.lastIndexOf('FIRST'));
	assert.ok(markdown.indexOf('FIRST') < markdown.indexOf('AAAA') && markdown.indexOf('AAAA') < markdown.indexOf('FINAL'));
});

test('no cut: first user turn inside the run is not re-pinned (anchor contributes 0)', () => {
	const c = conv([msg('m0', 'user', 'FIRST', T0), msg('m1', 'assistant', 'x'.repeat(50), T0 + 1000)]);
	const { markdown, info } = buildContinuation(c, { budgetTokens: 100 });
	assert.equal(info.turnsKept, 2); // run covers both; no separate anchor
	assert.equal(info.turnsOmitted, 0);
	assert.equal(info.charsKept, turnChars('user', 'FIRST') + turnChars('assistant', 'x'.repeat(50)));
	assert.ok(!markdown.includes('omitted for length'));
});

// ---- Delegate and degenerate inputs ---------------------------------------------

test('serializeContinuationMarkdown returns exactly buildContinuation().markdown', () => {
	const c = budgetConversation();
	const combos: Array<[Conversation, Parameters<typeof buildContinuation>[1]]> = [
		[c, {}],
		[c, { budgetTokens: 30 }],
		[c, { target: 'claude', provenance: false }],
		[c, { target: 'gemini', budgetTokens: 400 }],
	];
	for (const [conversation, opts] of combos) {
		assert.equal(serializeContinuationMarkdown(conversation, opts ?? {}), buildContinuation(conversation, opts ?? {}).markdown);
	}
});

test('assistant-only conversation: no crash, sane info, no You heading', () => {
	const c = conv([msg('a1', 'assistant', 'Only me.', T0), msg('a2', 'assistant', 'Still me.', T0 + 1000)]);
	const { markdown, info } = buildContinuation(c);
	assert.equal(info.turnsTotal, 2);
	assert.equal(info.turnsKept, 2);
	assert.equal(info.turnsOmitted, 0);
	assert.ok(!markdown.includes('## You'));
	assert.match(markdown, /_Resumed transcript: 2 turns, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}, gpt-4o\._/m);

	const empty = conv([]);
	const e = buildContinuation(empty);
	assert.deepEqual(
		{ total: e.info.turnsTotal, kept: e.info.turnsKept, omitted: e.info.turnsOmitted, chars: e.info.charsKept },
		{ total: 0, kept: 0, omitted: 0, chars: 0 }
	);
	// No finite stamps → no date clause; model still known.
	assert.ok(e.markdown.includes('_Resumed transcript: 0 turns, gpt-4o._'));
	assert.ok(e.markdown.startsWith('# Test chat\n\n_Resumed transcript: 0 turns, gpt-4o._\n\n' + GENERIC_PREAMBLE));
});
