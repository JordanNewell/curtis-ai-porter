// Source parser behavior: ChatGPT mapping trees, Claude exports, generic
// JSON transcripts, role-headed markdown — including what gets dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGptExport } from '../src/core/chatgpt';
import { parseClaudeExport } from '../src/core/claude';
import { parseGrokExport } from '../src/core/grok';
import { parseGeminiTakeout } from '../src/core/gemini';
import { parseGenericJson, parseGenericJsonAll, parseGenericMarkdown } from '../src/core/generic';

test('ChatGPT: flattens mapping chronologically, drops system/tool/empty nodes', () => {
	const exportJson = [
		{
			title: 'Architecture chat',
			create_time: 1700000000,
			update_time: 1700001000,
			mapping: {
				root: {},
				n1: { message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['You are ChatGPT'] }, create_time: 1699999999 } },
				n2: { message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Explain event loops'] }, create_time: 1700000000 } },
				n3: {
					message: {
						author: { role: 'assistant' },
						content: { content_type: 'text', parts: ['They are…'] },
						create_time: 1700000010,
						metadata: { model_slug: 'gpt-4o' },
					},
				},
				n4: { message: { author: { role: 'tool' }, content: { content_type: 'text', parts: ['tool output'] }, create_time: 1700000015 } },
				n5: { message: { author: { role: 'user' }, content: { content_type: 'text', parts: [] }, create_time: 1700000020 } },
			},
		},
	];
	const chats = parseChatGptExport(exportJson);
	assert.equal(chats.length, 1);
	const [chat] = chats;
	assert.equal(chat.title, 'Architecture chat');
	assert.equal(chat.provider, 'chatgpt');
	assert.equal(chat.model, 'gpt-4o');
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[0].content, 'Explain event loops');
	assert.equal(chat.messages[1].model, 'gpt-4o');
	assert.equal(chat.messages[0].timestamp, 1700000000000);
	assert.equal(chat.createdAt, 1700000000000);
});

test('ChatGPT: ignores conversations without a mapping', () => {
	assert.deepEqual(parseChatGptExport([{ title: 'not a chat' }]), []);
});

test('Claude: reads text field, content blocks, and ISO timestamps', () => {
	const exportJson = [
		{
			name: 'Refactor plan',
			created_at: '2026-09-01T10:00:00Z',
			updated_at: '2026-09-01T10:05:00Z',
			chat_messages: [
				{ sender: 'human', text: 'Refactor the store', created_at: '2026-09-01T10:00:00Z' },
				{
					sender: 'assistant',
					content: [{ type: 'text', text: 'Step one:' }, { type: 'text', text: 'extract the parser.' }],
					created_at: '2026-09-01T10:01:00Z',
				},
				{ sender: 'assistant', content: [{ type: 'image', source: {} }], created_at: '2026-09-01T10:02:00Z' },
			],
		},
	];
	const chats = parseClaudeExport(exportJson);
	assert.equal(chats.length, 1);
	const [chat] = chats;
	assert.equal(chat.title, 'Refactor plan');
	assert.equal(chat.provider, 'claude');
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[1].content, 'Step one:\nextract the parser.');
	assert.equal(chat.messages[0].timestamp, Date.parse('2026-09-01T10:00:00Z'));
});

test('generic JSON: role transcripts and from-keyed transcripts', () => {
	const chat = parseGenericJson([
		{ role: 'user', content: 'hi' },
		{ role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
	]);
	assert.ok(chat);
	assert.equal(chat.messages.length, 2);

	const fromKeyed = parseGenericJson({
		messages: [
			{ from: 'human', text: 'yo' },
			{ from: 'bot', text: 'sup' },
		],
	});
	assert.ok(fromKeyed);
	assert.deepEqual(fromKeyed.messages.map((m) => m.role), ['user', 'assistant']);
});

test('generic JSON: rejects documents with unattributable entries', () => {
	assert.equal(
		parseGenericJson([
			{ role: 'user', content: 'hi' },
			{ nonsense: true },
		]),
		null
	);
	assert.equal(parseGenericJson({ nope: 1 }), null);
});

test('generic markdown: heading style', () => {
	const md = `# Chat title

## You

What is a monad?

## AI

A monad is just a monoid in the category of endofunctors.
`;
	const chat = parseGenericMarkdown(md);
	assert.ok(chat);
	assert.equal(chat.title, 'Chat title');
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[1].content, 'A monad is just a monoid in the category of endofunctors.');
});

test('generic markdown: bold-label style with continuation lines', () => {
	const md = `**User:** plan Saturday

with the kids
**AI:** Here's an itinerary.
`;
	const chat = parseGenericMarkdown(md);
	assert.ok(chat);
	assert.equal(chat.messages[0].content, 'plan Saturday\n\nwith the kids');
	assert.equal(chat.messages[1].content, "Here's an itinerary.");
});

test('generic markdown: refuses documents without both sides', () => {
	assert.equal(parseGenericMarkdown('## You\n\njust a monologue'), null);
});

// ---- Grok (x.ai) export: conversations[] with nested responses[] ----

test('Grok: parses conversations with nested responses', () => {
	const exportJson = {
		conversations: [
			{
				title: 'Rocket questions',
				createTime: 1735689600,
				updateTime: 1735689700,
				responses: [
					{ role: 'user', message: 'How do rockets steer?', createTime: 1735689600 },
					{ role: 'assistant', message: 'Gimbaled engines and RCS thrusters.', createTime: 1735689660 },
					{ role: 'system', message: 'internal', createTime: 1735689661 },
				],
			},
		],
	};
	const chats = parseGrokExport(exportJson);
	assert.equal(chats.length, 1);
	const [chat] = chats;
	assert.equal(chat.title, 'Rocket questions');
	assert.equal(chat.provider, 'grok');
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[1].content, 'Gimbaled engines and RCS thrusters.');
	assert.equal(chat.messages[1].timestamp, 1735689660000);
});

test('Grok: rejects non-export JSON', () => {
	assert.deepEqual(parseGrokExport({ nope: true }), []);
	assert.deepEqual(parseGrokExport([{ nothing: 1 }]), []);
});

// ---- Gemini Takeout: "Prompted …" activity items ----

test('Gemini Takeout: pairs prompts with responses and groups by time gap', () => {
	const t = (h: number): string => new Date(1735689600000 + h * 3600000).toISOString();
	const exportJson = [
		{ header: 'Gemini Apps', title: 'Prompted what is a eclipse', time: t(0) },
		{ header: 'Gemini Apps', text: 'An eclipse happens when…', time: t(0.05) },
		{ header: 'Gemini Apps', title: 'Prompted and a solstice', time: t(0.1) },
		{ header: 'Gemini Apps', text: 'A solstice is a point in Earth’s orbit…', time: t(0.15) },
		{ header: 'Gemini Apps', title: 'Prompted next topic', time: t(9) },
		{ header: 'Gemini Apps', text: 'Sure, switching topics…', time: t(9.05) },
	];
	const chats = parseGeminiTakeout(exportJson);
	assert.equal(chats.length, 2);
	assert.equal(chats[0].provider, 'gemini');
	assert.equal(chats[0].title, 'what is a eclipse');
	assert.deepEqual(chats[0].messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
	assert.equal(chats[1].title, 'next topic');
});

test('Gemini Takeout: prompts-only exports yield nothing (conservative)', () => {
	const exportJson = [{ header: 'Gemini Apps', title: 'Prompted hello', time: '2026-01-01T10:00:00Z' }];
	assert.deepEqual(parseGeminiTakeout(exportJson), []);
});

// ---- Generic JSON v2: wrappers, containers, alternate role names ----

test('generic JSON: unwraps data/history wrappers', () => {
	const chat = parseGenericJson({
		data: [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'hello' },
		],
	});
	assert.ok(chat);
	assert.equal(chat.messages.length, 2);
});

test('generic JSON: containers of conversations (Open WebUI style)', () => {
	const chats = parseGenericJsonAll({
		conversations: [
			{ title: 'First', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
			{ name: 'Second', history: [{ from: 'human', text: 'c' }, { from: 'bot', text: 'd' }] },
		],
	});
	assert.equal(chats.length, 2);
	assert.equal(chats[0].title, 'First');
	assert.equal(chats[1].title, 'Second');
	assert.deepEqual(chats[1].messages.map((m) => m.role), ['user', 'assistant']);
});

test('generic JSON: sender/author role variants and block content', () => {
	const chat = parseGenericJson([
		{ sender: 'user', message: 'q' },
		{ author: { role: 'assistant' }, content: [{ type: 'text', text: 'a' }] },
	]);
	assert.ok(chat);
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[1].content, 'a');
});

// ---- Chinese speaker labels (z.ai, Kimi, Doubao, Ernie, MiniMax pastes) ----

test('generic markdown: Chinese bold labels with full-width colon', () => {
	const md = '**用户：**帮我写一首诗\n**AI：**好的，来一首关于秋天的。';
	const chat = parseGenericMarkdown(md);
	assert.ok(chat);
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[0].content, '帮我写一首诗');
});

test('generic markdown: Chinese heading labels 我/助手', () => {
	const md = `## 我

解释一下递归

## 助手

递归就是函数调用自己。
`;
	const chat = parseGenericMarkdown(md);
	assert.ok(chat);
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[1].content, '递归就是函数调用自己。');
});

// ---- Bare inline labels (the paste style the README and web UI advertise) ----

test('generic markdown: inline labels You:/AI:', () => {
	const md = `# Weekend planning

You: Two days in Lisbon with kids?

AI: Keep it to one neighborhood a day.
`;
	const chat = parseGenericMarkdown(md);
	assert.ok(chat);
	assert.equal(chat.title, 'Weekend planning');
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[0].content, 'Two days in Lisbon with kids?');
});

test('generic markdown: inline label alone on a line takes following lines', () => {
	const md = `You:
first part

still the first message

AI:
answer here
`;
	const chat = parseGenericMarkdown(md);
	assert.ok(chat);
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[0].content, 'first part\n\nstill the first message');
	assert.equal(chat.messages[1].content, 'answer here');
});

test('generic markdown: Chinese inline labels with full-width colon', () => {
	const chat = parseGenericMarkdown('我：今天天气怎么样？\nAI：晴，适合出门。');
	assert.ok(chat);
	assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
	assert.equal(chat.messages[0].content, '今天天气怎么样？');
});

test('generic markdown: prose colons are not mistaken for speakers', () => {
	assert.equal(parseGenericMarkdown('Day 1: arrived\nDay 2: left'), null);
	assert.equal(parseGenericMarkdown('10:00 standup\n11:00 lunch'), null);
	assert.equal(parseGenericMarkdown('Note: the label word must be known\nAlso: this one'), null);
});
