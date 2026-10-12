// Detection: extension routing, structural JSON signatures, zip scanning,
// Curtis markdown recognition, normalization and dedupe keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { detectAndParse, parsedChatToConversation, conversationDedupeKey } from '../src/core/detect';
import { serializeCurt } from '../src/core/curt';
import { serializeCurtisMarkdown } from '../src/core/curtis-md';
import type { Conversation } from '../src/core/types';

function chatgptExportJson(): unknown {
	return [
		{
			title: 'zip chat',
			create_time: 1700000000,
			mapping: {
				a: { message: { author: { role: 'user' }, content: { parts: ['hello from the zip'] }, create_time: 1700000000 } },
				b: { message: { author: { role: 'assistant' }, content: { parts: ['hi'] }, create_time: 1700000010 } },
			},
		},
	];
}

function u8(json: unknown): Uint8Array {
	return strToU8(JSON.stringify(json));
}

test('zip: finds canonical conversations.json at any depth', () => {
	const zipped = zipSync({ 'some/folder/deep/conversations.json': u8(chatgptExportJson()) });
	const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
	const detected = detectAndParse('ChatGPT-Export.zip', buf);
	assert.equal(detected.format, 'chatgpt');
	assert.equal(detected.chats[0].title, 'zip chat');
});

test('zip: scans any json when conversations.json is absent', () => {
	const zipped = zipSync({ 'data dump/chat log.json': u8(chatgptExportJson()) });
	const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
	assert.equal(detectAndParse('weird.zip', buf).format, 'chatgpt');
});

test('zip: reports unknown for non-chat archives', () => {
	const zipped = zipSync({ 'readme.txt': strToU8('nothing here') });
	const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
	assert.equal(detectAndParse('x.zip', buf).format, 'unknown');
});

test('zip: recognizes a bulk export of .curt files', () => {
	const convs: Conversation[] = [1, 2].map((n) => ({
		id: `conv_${n}_abc${n}def`,
		title: `Chat number ${n}`,
		createdAt: 1700000000 + n,
		updatedAt: 1700000000 + n,
		provider: 'openai',
		model: 'gpt-4o',
		messages: [{ id: `msg_${n}_abc${n}def`, role: 'user' as const, content: `hello ${n}`, timestamp: 1700000000 + n }],
	}));
	const zipped = zipSync({
		'2024-12-31 Chat number 1 abcdef.curt': strToU8(serializeCurt(convs[0])),
		'2024-12-31 Chat number 2 abcdef.curt': strToU8(serializeCurt(convs[1])),
		'corrupted.curt': strToU8('{ not a curt file'),
	});
	const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
	const detected = detectAndParse('curtis-chats-20261007-1200.zip', buf);
	assert.equal(detected.format, 'curt');
	assert.equal(detected.conversations?.length, 2);
	assert.deepEqual(detected.conversations, convs);
});

test('zip: a Curtis.ai full-backup zip yields its conversations like a bulk export', () => {
	// The plugin's v2.0.1 full-backup shape: manifest with the curtis-backup
	// magic, conversations as .curt entries, plus non-chat sections (prompts,
	// harnesses, settings) the porter has no use for. The conversations import
	// through the same .curt-entry path as a bulk export; the extra JSON must
	// not derail detection (manifest.json parses first and carries no chats).
	const convs: Conversation[] = [1, 2].map((n) => ({
		id: `conv_${n}_bak${n}cdef`,
		title: `Backup chat ${n}`,
		createdAt: 1700000000 + n,
		updatedAt: 1700000000 + n,
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		messages: [{ id: `msg_${n}_bak${n}cdef`, role: 'user' as const, content: `from the backup ${n}`, timestamp: 1700000000 + n }],
	}));
	const zipped = zipSync({
		'manifest.json': u8({ curtis: 'curtis-backup', version: 1, generator: 'curtis-ai-chat@2.0.1', exportedAt: 1700000100 }),
		'conversations/2024-12-31 Backup chat 1 bak1cdef.curt': strToU8(serializeCurt(convs[0])),
		'conversations/2024-12-31 Backup chat 2 bak2cdef.curt': strToU8(serializeCurt(convs[1])),
		'prompts.json': u8([{ id: 'p1', name: 'Summarize', content: 'Summarize this note.' }]),
		'harnesses.json': u8([]),
		'settings.json': u8({ theme: 'dark' }),
	});
	const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
	const detected = detectAndParse('curtis-backup-20261011.zip', buf);
	assert.equal(detected.format, 'curt');
	assert.equal(detected.chats.length, 0);
	assert.deepEqual(detected.conversations, convs);
});

test('zip detection works without the .zip extension (magic bytes)', () => {
	const zipped = zipSync({ 'conversations.json': u8(chatgptExportJson()) });
	const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
	assert.equal(detectAndParse('export.backup', buf).format, 'chatgpt');
});

test('bare conversations.json is detected by structure, not name', () => {
	const json = JSON.stringify(chatgptExportJson());
	const buf = new TextEncoder().encode(json).buffer as ArrayBuffer;
	const detected = detectAndParse('download.json', buf);
	assert.equal(detected.format, 'chatgpt');
	assert.equal(detected.chats[0].messages.length, 2);
});

test('.curt files round-trip full conversations', () => {
	const conv: Conversation = {
		id: 'conv_1_abc',
		title: 'Saved chat',
		createdAt: 100,
		updatedAt: 200,
		provider: 'openai',
		model: 'gpt-4o',
		messages: [{ id: 'msg_1_abc', role: 'user', content: 'hello', timestamp: 100 }],
	};
	const buf = new TextEncoder().encode(serializeCurt(conv)).buffer as ArrayBuffer;
	const detected = detectAndParse('saved.curt', buf);
	assert.equal(detected.format, 'curt');
	assert.deepEqual(detected.conversations, [conv]);
});

test('Curtis markdown is recognized and reparsed', () => {
	const conv: Conversation = {
		id: 'conv_2_def',
		title: 'Vault chat',
		createdAt: 1000,
		updatedAt: 2000,
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		messages: [
			{ id: 'msg_2_def', role: 'user', content: 'from another vault', timestamp: 1000 },
			{ id: 'msg_2_ghi', role: 'assistant', content: 'welcome', timestamp: 2000 },
		],
	};
	const md = serializeCurtisMarkdown(conv);
	const buf = new TextEncoder().encode(md).buffer as ArrayBuffer;
	const detected = detectAndParse('2026-09-01 Vault chat def.md', buf);
	assert.equal(detected.format, 'curtis-md');
	assert.equal(detected.conversations?.[0].title, 'Vault chat');
	assert.equal(detected.conversations?.[0].messages.length, 2);
});

test('parsedChatToConversation normalizes and clamps timestamps', () => {
	const conv = parsedChatToConversation({
		title: 'T',
		messages: [
			{ role: 'user', content: 'a', timestamp: 500 },
			{ role: 'tool', content: 'dropped', timestamp: 600 },
			{ role: 'assistant', content: 'b', timestamp: 300 },
		],
		createdAt: 500,
		updatedAt: 300,
	});
	assert.deepEqual(
		conv.messages.map((m) => m.role),
		['user', 'assistant']
	);
	assert.equal(conv.createdAt, 300);
	assert.equal(conv.updatedAt, 500);
	assert.equal(conv.id, '');
});

test('dedupe key: title + count + first user message', () => {
	const a = conversationDedupeKey({
		id: 'x',
		title: 'Hello',
		createdAt: 1,
		updatedAt: 2,
		provider: '',
		model: '',
		messages: [{ id: '1', role: 'user', content: 'first message here', timestamp: 1 }],
	});
	const b = conversationDedupeKey({
		id: 'different-id',
		title: 'hello',
		createdAt: 9,
		updatedAt: 9,
		provider: 'openai',
		model: 'gpt-4o',
		messages: [{ id: '2', role: 'user', content: 'first message here', timestamp: 3 }],
	});
	assert.equal(a, b);
});
