// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Export direction: the ChatGPT-shape round-trip self-test (through the
// porter's own importer), API JSONL fidelity, continuation-pack budget
// behavior, and the dispatcher's file layout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAndParse, parsedChatToConversation } from '../src/core/detect';
import { assignIds } from '../src/core/ids';
import { convertFiles } from '../src/core/convert';
import { serializeChatGptShape } from '../src/core/export/chatgpt-shape';
import { serializeApiJsonl } from '../src/core/export/api-jsonl';
import { serializeContinuationMarkdown } from '../src/core/export/continuation-md';
import { exportTargets, serializeExport } from '../src/core/export';
import type { Conversation, ConversationMessage, MessageRole } from '../src/core/types';

// ---- Fixtures ---------------------------------------------------------------

function msg(id: string, role: MessageRole, content: string, timestamp: number, extra: Partial<ConversationMessage> = {}): ConversationMessage {
	return { id, role, content, timestamp, ...extra };
}

function sampleConversation(): Conversation {
	return {
		id: 'conv_1700000000000_abc123def',
		title: 'Lisbon weekend',
		createdAt: 1700000000000,
		updatedAt: 1700000040000,
		provider: 'openai',
		model: 'gpt-4o',
		messages: [
			msg('msg_1700000000000_a1b2c3', 'user', 'Two days in Lisbon with kids?', 1700000000000),
			msg('msg_1700000010000_d4e5f6', 'assistant', 'Keep it to one neighborhood a day.', 1700000010000, { model: 'gpt-4o' }),
			msg('msg_1700000020000_g7h8i9', 'system', 'platform prompt, not user content', 1700000020000),
			msg('msg_1700000030000_j1k2l3', 'user', 'What about food?', 1700000030000),
			msg('msg_1700000040000_m4n5o6', 'assistant', 'Pastéis de nata, obviously.', 1700000040000, { model: 'gpt-4o' }),
		],
	};
}

function secondConversation(): Conversation {
	return {
		id: 'conv_1700000100000_xyz789ghi',
		title: 'Rocket questions',
		createdAt: 1700000100000,
		updatedAt: 1700000110000,
		provider: 'openai',
		model: 'gpt-4o',
		messages: [
			msg('msg_1700000100000_n7p8q9', 'user', 'How do rockets steer?', 1700000100000),
			msg('msg_1700000110000_r1s2t3', 'assistant', 'Gimbaled engines and RCS thrusters.', 1700000110000, { model: 'gpt-4o' }),
		],
	};
}

function toJsonBuffer(json: string): ArrayBuffer {
	const bytes = new TextEncoder().encode(json);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// ---- ChatGPT shape: the round-trip self-test --------------------------------

test('ChatGPT shape: round-trips through the porter importer (title, order, contents, timestamps)', () => {
	const conv = sampleConversation();
	const json = serializeChatGptShape([conv]);
	const detected = detectAndParse('conversations.json', toJsonBuffer(json));
	assert.equal(detected.format, 'chatgpt');
	assert.equal(detected.chats.length, 1);

	const back = parsedChatToConversation(detected.chats[0]);
	assignIds(back);
	assert.equal(back.title, conv.title);
	assert.equal(back.createdAt, conv.createdAt); // whole-second ms survive seconds
	assert.equal(back.updatedAt, conv.updatedAt);
	assert.equal(detected.chats[0].model, 'gpt-4o');

	const src = conv.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	assert.deepEqual(
		back.messages.map((m) => [m.role, m.content, m.timestamp]),
		src.map((m) => [m.role, m.content, m.timestamp])
	);
	// Fresh ids were assigned where needed, and are unique.
	assert.equal(new Set(back.messages.map((m) => m.id)).size, back.messages.length);
	assert.ok(back.id.startsWith('conv_'));
});

test('ChatGPT shape: linear mapping chain with parent/children, node ids, epoch seconds', () => {
	const conv = sampleConversation();
	const data = JSON.parse(serializeChatGptShape([conv]));
	assert.ok(Array.isArray(data));
	const c = data[0];
	assert.equal(c.conversation_id, conv.id);
	assert.equal(c.title, conv.title);
	assert.equal(c.create_time, 1700000000);
	assert.equal(c.update_time, 1700000040);

	// Walk the chain from root; system nodes were never emitted.
	const order: string[] = [];
	let cursor = 'root';
	for (;;) {
		const child = c.mapping[cursor]?.children?.[0];
		if (!child) break;
		order.push(child);
		cursor = child;
	}
	assert.deepEqual(order, [
		'msg_1700000000000_a1b2c3',
		'msg_1700000010000_d4e5f6',
		'msg_1700000030000_j1k2l3',
		'msg_1700000040000_m4n5o6',
	]);

	const first = c.mapping[order[0]];
	assert.equal(first.message.author.role, 'user');
	assert.equal(first.message.create_time, 1700000000);
	assert.equal(first.message.recipient, 'all');
	assert.deepEqual(first.message.content, { content_type: 'text', parts: ['Two days in Lisbon with kids?'] });
	assert.deepEqual(c.mapping[order[0]].parent, 'root');
	assert.deepEqual(c.mapping[order[3]].children, []);
	assert.equal(c.mapping[order[3]].parent, order[2]);
	assert.equal(c.mapping[order[3]].message.metadata.model_slug, 'gpt-4o');
	// system message: absent from the emitted mapping
	assert.equal(c.mapping['msg_1700000020000_g7h8i9'], undefined);
});

test('ChatGPT shape: several conversations survive as one array', () => {
	const json = serializeChatGptShape([sampleConversation(), secondConversation()]);
	const detected = detectAndParse('conversations.json', toJsonBuffer(json));
	assert.equal(detected.format, 'chatgpt');
	assert.deepEqual(detected.chats.map((ch) => ch.title), ['Lisbon weekend', 'Rocket questions']);
	assert.equal(detected.chats[1].messages[1].content, 'Gimbaled engines and RCS thrusters.');
});

test('ChatGPT shape: convertFiles accepts the emitted document end-to-end', () => {
	const json = serializeChatGptShape([sampleConversation()]);
	const reports = convertFiles([{ name: 'conversations.json', buffer: toJsonBuffer(json) }]);
	assert.equal(reports[0].error, undefined);
	assert.equal(reports[0].format, 'chatgpt');
	assert.equal(reports[0].chats.length, 1);
	const conv = reports[0].chats[0].conversation;
	assert.equal(conv.title, 'Lisbon weekend');
	assert.equal(conv.messages[0].content, 'Two days in Lisbon with kids?');
	assert.ok(conv.id.startsWith('conv_'));
});

// ---- API JSONL ----------------------------------------------------------------

test('API JSONL: one valid JSON line per conversation, faithful roles and contents', () => {
	const first: Conversation = {
		id: 'conv_1_abc',
		title: 'With system',
		createdAt: 1000,
		updatedAt: 4000,
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		messages: [
			msg('m1', 'system', 'You are helpful.', 1000),
			msg('m2', 'user', 'hi', 2000),
			msg('m3', 'assistant', 'hello', 3000),
			msg('m4', 'system', 'mid-chat system noise', 3500),
			msg('m5', 'tool', 'tool output', 3600),
		],
	};
	const text = serializeApiJsonl([first, secondConversation()]);
	const lines = text.trim().split('\n');
	assert.equal(lines.length, 2);

	const [l1, l2] = lines.map((l) => JSON.parse(l));
	assert.deepEqual(l1.messages, [
		{ role: 'system', content: 'You are helpful.' },
		{ role: 'user', content: 'hi' },
		{ role: 'assistant', content: 'hello' },
	]);
	assert.deepEqual(l2.messages, [
		{ role: 'user', content: 'How do rockets steer?' },
		{ role: 'assistant', content: 'Gimbaled engines and RCS thrusters.' },
	]);
});

test('API JSONL: every emitted line parses and roles are provider-safe', () => {
	const text = serializeApiJsonl([sampleConversation(), secondConversation()]);
	for (const line of text.trim().split('\n')) {
		const obj = JSON.parse(line);
		assert.ok(Array.isArray(obj.messages));
		assert.ok(obj.messages.length > 0);
		for (const m of obj.messages) {
			assert.ok(['user', 'assistant', 'system'].includes(m.role));
			assert.equal(typeof m.content, 'string');
		}
	}
	assert.equal(serializeApiJsonl([]), '');
});

// ---- Continuation pack ---------------------------------------------------------

test('Continuation pack: title, preamble, full transcript when under the default budget', () => {
	const conv = sampleConversation();
	const md = serializeContinuationMarkdown(conv);
	assert.ok(md.startsWith(`# ${conv.title}\n`));
	assert.ok(md.includes('The following is a transcript of a previous conversation between the user and an AI assistant.'));
	assert.ok(md.includes('## You'));
	assert.ok(md.includes('## Assistant'));
	assert.ok(md.includes('Two days in Lisbon with kids?'));
	assert.ok(md.includes('Pastéis de nata, obviously.'));
	assert.ok(!md.includes('omitted for length')); // nothing dropped
	assert.ok(!md.includes('platform prompt')); // system skipped
	// turns stay in conversation order
	assert.ok(md.indexOf('Two days in Lisbon') < md.indexOf('Keep it to one neighborhood'));
	assert.ok(md.indexOf('Keep it to one neighborhood') < md.indexOf('What about food?'));
	assert.ok(md.indexOf('What about food?') < md.indexOf('Pastéis de nata'));
});

test('Continuation pack: tiny budget keeps first user message + latest turns, marker for the rest', () => {
	const conv: Conversation = {
		id: 'conv_2000000000000_budget1',
		title: 'Long chat',
		createdAt: 2000000000000,
		updatedAt: 2000000005000,
		provider: 'openai',
		model: 'gpt-4o',
		messages: [
			msg('m0', 'user', 'Two days in Lisbon with kids?', 2000000000000),
			msg('m1', 'assistant', 'A'.repeat(400), 2000000001000),
			msg('m2', 'user', 'B'.repeat(400), 2000000002000),
			msg('m3', 'assistant', 'C'.repeat(400), 2000000003000),
			msg('m4', 'user', 'D'.repeat(400), 2000000004000),
			msg('m5', 'assistant', 'FINAL ANSWER', 2000000005000),
		],
	};
	// 30 tokens = 120 chars: only the last turn (26 rendered chars) fits.
	const md = serializeContinuationMarkdown(conv, { budgetTokens: 30 });
	assert.ok(md.startsWith('# Long chat\n'));
	assert.ok(md.includes('Two days in Lisbon with kids?')); // first user message always kept
	assert.ok(md.includes('FINAL ANSWER')); // most recent turn kept
	assert.ok(!md.includes('AAAA')); // older turns dropped
	const marker = md.match(/_\[… (\d+) earlier turns? omitted for length …\]_/);
	assert.ok(marker, 'omission marker present');
	assert.equal(Number(marker![1]), 4); // m1..m4 hidden
	assert.ok(md.indexOf('Two days in Lisbon') < md.indexOf('omitted for length'));
	assert.ok(md.indexOf('omitted for length') < md.indexOf('FINAL ANSWER'));
});

test('Continuation pack: budget covering everything emits no marker', () => {
	const md = serializeContinuationMarkdown(sampleConversation(), { budgetTokens: 30000 });
	assert.ok(!md.includes('omitted for length'));
});

test('Continuation pack: images become placeholders, system/tool skipped', () => {
	const conv: Conversation = {
		id: 'conv_3000000000000_images',
		title: 'Screenshot review',
		createdAt: 3000000000000,
		updatedAt: 3000000002000,
		provider: 'openai',
		model: 'gpt-4o',
		messages: [
			msg('m1', 'user', 'Look at this', 3000000000000, { images: ['data:image/png;base64,AAAA'] }),
			msg('m2', 'tool', 'tool output', 3000000001000),
			msg('m3', 'assistant', 'I see a screenshot.', 3000000002000),
		],
	};
	const md = serializeContinuationMarkdown(conv);
	assert.ok(md.includes('_[image omitted]_'));
	assert.ok(md.includes('Look at this'));
	assert.ok(md.includes('I see a screenshot.'));
	assert.ok(!md.includes('tool output'));
	assert.ok(!md.includes('data:image')); // raw data URLs never leak into the pack
});

// ---- Dispatcher -----------------------------------------------------------------

test('dispatcher: targets are declared with id, label, extension', () => {
	assert.deepEqual(
		exportTargets.map((t) => [t.id, t.label, t.extension]),
		[
			['chatgpt-json', 'ChatGPT conversations.json', 'json'],
			['api-jsonl', 'API JSONL', 'jsonl'],
			['continuation-md', 'Continuation pack', 'md'],
		]
	);
});

test('dispatcher: file layout per target', () => {
	const one = [sampleConversation()];
	const two = [sampleConversation(), secondConversation()];

	assert.deepEqual(serializeExport('chatgpt-json', one).files.map((f) => f.name), ['conversations.json']);
	assert.deepEqual(serializeExport('chatgpt-json', two).files.map((f) => f.name), ['conversations.json']);
	assert.equal(serializeExport('chatgpt-json', []).files[0].body, '[]');

	assert.deepEqual(serializeExport('api-jsonl', one).files.map((f) => f.name), ['Lisbon weekend.jsonl']);
	assert.deepEqual(serializeExport('api-jsonl', two).files.map((f) => f.name), ['conversations.jsonl']);
	assert.deepEqual(serializeExport('api-jsonl', []).files, []);

	const cont = serializeExport('continuation-md', one, { budgetTokens: 10 });
	assert.deepEqual(cont.files.map((f) => f.name), ['Lisbon weekend (continuation).md']);
	assert.ok(cont.files[0].body.startsWith('# Lisbon weekend'));

	// same-titled conversations get disambiguated, like .curt filenames
	const dupA: Conversation = { ...sampleConversation(), id: 'conv_1_aaa111bbb', title: 'Same' };
	const dupB: Conversation = { ...sampleConversation(), id: 'conv_2_ccc222ddd', title: 'Same' };
	const dups = serializeExport('continuation-md', [dupA, dupB]);
	assert.deepEqual(dups.files.map((f) => f.name), ['Same (continuation).md', 'Same (continuation) 222ddd.md']);
	assert.deepEqual(serializeExport('continuation-md', []).files, []);
});
