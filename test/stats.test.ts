// Stats: aggregation over conversations (counts, words, tokens, cost,
// timeline, provider/model/month breakdowns, largest) and the plain-text
// renderer — including hostile exports, where NaN/Infinity must never reach
// any aggregate or any rendered line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, renderStatsText } from '../src/core/stats';
import type { Conversation, ConversationMessage, MessageRole } from '../src/core/types';

// ---- Fixtures ---------------------------------------------------------------

function msg(id: string, role: MessageRole, content: string, timestamp: number, extra: Partial<ConversationMessage> = {}): ConversationMessage {
	return { id, role, content, timestamp, ...extra };
}

/** Local-time epoch ms, so byMonth and span assertions hold in any timezone. */
function at(month: number, day: number, hour: number, minute: number): number {
	return new Date(2023, month - 1, day, hour, minute, 0).getTime();
}

function lisbonConversation(): Conversation {
	return {
		id: 'conv_1700000000000_abc123def',
		title: 'Lisbon weekend',
		createdAt: at(11, 14, 12, 0),
		updatedAt: at(11, 14, 12, 5),
		provider: 'openai',
		model: 'gpt-4o',
		messages: [
			msg('m1', 'user', 'Two days in Lisbon with kids?', at(11, 14, 12, 0), {
				tokens: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
				cost: 0.0001,
			}),
			msg('m2', 'assistant', 'Keep it to one neighborhood a day.', at(11, 14, 12, 1), {
				model: 'gpt-4o',
				tokens: { promptTokens: 20, completionTokens: 30, totalTokens: 50 },
				cost: 0.0009,
			}),
			msg('m3', 'system', 'platform prompt, not user content', at(11, 14, 12, 2)),
			msg('m4', 'tool', 'tool output payload', at(11, 14, 12, 3)),
			msg('m5', 'user', 'What about food?', at(11, 14, 12, 4), {
				tokens: { promptTokens: 15, completionTokens: 0, totalTokens: 15 },
			}),
			msg('m6', 'assistant', 'Pastéis de nata, obviously.', at(11, 14, 12, 5), {
				model: 'gpt-4o',
				tokens: { promptTokens: 25, completionTokens: 35, totalTokens: 60 },
				cost: 0.0011,
			}),
		],
	};
}

function rocketConversation(): Conversation {
	return {
		id: 'conv_1700000100000_xyz789ghi',
		title: 'Rocket questions',
		createdAt: at(11, 30, 23, 30),
		updatedAt: at(12, 1, 0, 30),
		provider: 'anthropic',
		model: 'claude-haiku',
		messages: [
			msg('m1', 'user', 'How do rockets steer?', at(11, 30, 23, 30)),
			msg('m2', 'assistant', 'Gimbaled engines and RCS thrusters.', at(12, 1, 0, 30), { model: 'claude-sonnet-4-5' }),
		],
	};
}

function assertAllFinite(value: unknown, path = 'stats'): void {
	if (typeof value === 'number') {
		assert.ok(Number.isFinite(value), `${path} is finite (got ${value})`);
	} else if (Array.isArray(value)) {
		value.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`));
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
	}
}

// ---- Full aggregation --------------------------------------------------------

test('stats: two conversations, every aggregate asserted exactly', () => {
	const s = computeStats([lisbonConversation(), rocketConversation()]);
	assert.equal(s.conversations, 2);
	assert.equal(s.messages, 8);
	assert.equal(s.userMessages, 3);
	assert.equal(s.assistantMessages, 3);
	assert.equal(s.toolMessages, 1);
	assert.equal(s.systemMessages, 1);
	// user+assistant content only; system and tool contents excluded
	assert.equal(s.words, 29);
	assert.deepEqual(s.tokens, { prompt: 70, completion: 65, total: 135, reportedBy: 4 });
	assert.equal(s.cost.reportedBy, 3);
	assert.ok(Math.abs(s.cost.total - 0.0021) < 1e-12);
	assert.equal(s.firstActivity, at(11, 14, 12, 0));
	assert.equal(s.lastActivity, at(12, 1, 0, 30));
	assert.deepEqual(s.byProvider, { openai: 1, anthropic: 1 });
	// the assistant message's model wins over the conversation's model field
	assert.deepEqual(s.byModel, { 'gpt-4o': 1, 'claude-sonnet-4-5': 1 });
	// month boundary crossed inside a conversation (Nov 30 -> Dec 1, local time)
	assert.deepEqual(s.byMonth, { '2023-11': 7, '2023-12': 1 });
	assert.deepEqual(s.largest, [
		{ id: 'conv_1700000000000_abc123def', title: 'Lisbon weekend', messages: 6 },
		{ id: 'conv_1700000100000_xyz789ghi', title: 'Rocket questions', messages: 2 },
	]);
});

test('stats: largest is top 5 by message count, ties broken by id, deterministic, input untouched', () => {
	const build = (id: string, title: string, n: number): Conversation => ({
		id,
		title,
		createdAt: 0,
		updatedAt: 0,
		provider: 'p',
		model: 'm',
		messages: Array.from({ length: n }, (_, i) => msg(`m${i}`, 'user', 'x', 1000 + i)),
	});
	const convs = [
		build('conv_01_a', 'two', 2),
		build('conv_02_b', 'five-b', 5),
		build('conv_03_c', 'five-c', 5),
		build('conv_04_d', 'one', 1),
		build('conv_05_e', 'nine', 9),
		build('conv_06_f', 'three', 3),
	];
	const s1 = computeStats(convs);
	const s2 = computeStats(convs);
	assert.deepEqual(s1.largest, s2.largest);
	assert.deepEqual(s1.largest.map((c) => [c.title, c.messages]), [
		['nine', 9],
		['five-b', 5],
		['five-c', 5],
		['three', 3],
		['two', 2],
	]);
	assert.equal(s1.largest.length, 5); // the 1-message conversation is cut
	assert.deepEqual(convs.map((c) => c.id), ['conv_01_a', 'conv_02_b', 'conv_03_c', 'conv_04_d', 'conv_05_e', 'conv_06_f']);
});

// ---- reportedBy ---------------------------------------------------------------

test('stats: reportedBy counts only messages carrying tokens/cost', () => {
	const conv: Conversation = {
		id: 'conv_1_aaa111bbb',
		title: 'Sparse accounting',
		createdAt: 1000,
		updatedAt: 4000,
		provider: 'openai',
		model: 'gpt-4o',
		messages: [
			msg('m1', 'user', 'a', 1000, { tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, cost: 0.5 }),
			msg('m2', 'assistant', 'b', 2000, { tokens: { promptTokens: 8, completionTokens: 4, totalTokens: 12 } }),
			msg('m3', 'user', 'c', 3000, { cost: 0.25 }),
			msg('m4', 'assistant', 'd', 4000),
		],
	};
	const s = computeStats([conv]);
	assert.deepEqual(s.tokens, { prompt: 18, completion: 9, total: 27, reportedBy: 2 });
	assert.deepEqual(s.cost, { total: 0.75, reportedBy: 2 });
});

// ---- Hostile values -------------------------------------------------------------

test('stats: NaN/Infinity in hostile fields is ignored end to end', () => {
	const conv: Conversation = {
		id: 'conv_2_bbb222ccc',
		title: 'Hostile export',
		createdAt: Number.NaN,
		updatedAt: Number.POSITIVE_INFINITY,
		provider: '',
		model: '',
		messages: [
			msg('m1', 'user', 'still here', 1700000000000, {
				tokens: { promptTokens: Number.NaN, completionTokens: Number.POSITIVE_INFINITY, totalTokens: Number.NEGATIVE_INFINITY },
				cost: Number.NaN,
			}),
			msg('m2', 'assistant', 'me too', Number.NaN, {
				model: 'gpt-x',
				tokens: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
				cost: Number.POSITIVE_INFINITY,
			}),
			msg('m3', 'user', '  spaced\t out \n words  ', Number.POSITIVE_INFINITY),
		],
	};
	const s = computeStats([conv]);
	assertAllFinite(s);
	assert.deepEqual(s.tokens, { prompt: 12, completion: 8, total: 20, reportedBy: 2 });
	assert.equal(s.cost.total, 0);
	assert.equal(s.cost.reportedBy, 2); // the field was carried, its value ignored
	assert.deepEqual(s.byProvider, {}); // empty provider keys are skipped
	assert.deepEqual(s.byModel, { 'gpt-x': 1 });
	assert.equal(s.firstActivity, 1700000000000);
	assert.equal(s.lastActivity, 1700000000000);
	// the only finite timestamp, month computed in local time like the implementation
	const d = new Date(1700000000000);
	const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	assert.deepEqual(s.byMonth, { [key]: 1 });
	// messy whitespace counts as words, not as one blob or extra empties
	assert.equal(s.words, 7);

	const text = renderStatsText(s);
	assert.ok(!text.includes('NaN'));
	assert.ok(!text.includes('Infinity'));
	assert.ok(!text.includes('undefined'));
});

// ---- Timestamp fallback ---------------------------------------------------------

test('stats: first/last activity fall back to conversation createdAt/updatedAt', () => {
	const undated: Conversation = {
		id: 'conv_3_ccc333ddd',
		title: 'Undated messages',
		createdAt: 1111,
		updatedAt: 9999,
		provider: 'p',
		model: 'm',
		messages: [msg('m1', 'user', 'when?', Number.NaN), msg('m2', 'assistant', 'no idea', Number.POSITIVE_INFINITY)],
	};
	const empty: Conversation = { id: 'conv_4_ddd444eee', title: 'Empty', createdAt: 2222, updatedAt: 8888, provider: 'p', model: 'm', messages: [] };
	const s = computeStats([undated, empty]);
	assert.equal(s.firstActivity, 1111);
	assert.equal(s.lastActivity, 9999);

	const nowhere: Conversation = { id: 'conv_5_eee555fff', title: 'No timeline', createdAt: Number.NaN, updatedAt: Number.NaN, provider: '', model: '', messages: [] };
	const sNone = computeStats([nowhere]);
	assert.equal(sNone.firstActivity, undefined);
	assert.equal(sNone.lastActivity, undefined);
	const text = renderStatsText(sNone);
	assert.ok(!text.includes('undefined'));
	assert.ok(text.includes('unknown'));
});

// ---- Empty input -----------------------------------------------------------------

test('stats: empty input zeroes everything and renders cleanly', () => {
	const s = computeStats([]);
	assert.deepEqual(s, {
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
	});
	const text = renderStatsText(s);
	assert.equal(typeof text, 'string');
	assert.ok(text.length > 0);
	assert.ok(!text.includes('NaN'));
	assert.ok(!text.includes('undefined'));
	assert.ok(text.includes('(none)'));
});

// ---- Renderer shape ----------------------------------------------------------------

test('renderStatsText: fixed sections, aligned span, month order, largest titles', () => {
	const text = renderStatsText(computeStats([lisbonConversation(), rocketConversation()]));
	for (const header of ['Overview', 'Tokens', 'Cost', 'Providers', 'Models', 'Activity by month', 'Largest conversations']) {
		assert.ok(text.includes(header), `section header present: ${header}`);
	}
	assert.ok(text.includes('=================='));
	assert.ok(text.includes('--------'));
	// span as YYYY-MM-DD..YYYY-MM-DD (local dates of local-time fixtures)
	assert.ok(text.includes('2023-11-14..2023-12-01'));
	assert.ok(text.includes('Avg messages/conv'));
	assert.ok(text.includes('4.0')); // 8 messages / 2 conversations
	assert.ok(text.includes('0.0021')); // cost, 4 decimals
	// largest entries carry their conversation titles
	assert.ok(text.includes('Lisbon weekend'));
	assert.ok(text.includes('Rocket questions'));
	assert.ok(/1\. Lisbon weekend \(6 messages\)/.test(text));
	// months chronological within their own section
	const monthSection = text.slice(text.indexOf('Activity by month'));
	assert.ok(/^2023-11 +7$/m.test(monthSection));
	assert.ok(/^2023-12 +1$/m.test(monthSection));
	assert.ok(monthSection.indexOf('2023-11') < monthSection.indexOf('2023-12'));
});
