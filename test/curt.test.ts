// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// .curt serialization contract: magic/version validation, round-trip
// fidelity (tokens, tool calls, images survive verbatim), strict rejection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCurt, serializeCurt, CURT_FORMAT } from '../src/core/curt';
import { serializeCurtisMarkdown, parseConversationMarkdown } from '../src/core/curtis-md';
import type { Conversation } from '../src/core/types';

function sampleConversation(): Conversation {
	return {
		id: 'conv_1791000000000_abc123def',
		title: 'Weekly review',
		createdAt: 1791000000000,
		updatedAt: 1791000600000,
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		messages: [
			{ id: 'msg_1791000000000_a1b2c3', role: 'user', content: 'Plan my week', timestamp: 1791000000000 },
			{
				id: 'msg_1791000100000_d4e5f6',
				role: 'assistant',
				content: 'Here is a plan.',
				timestamp: 1791000100000,
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				tokens: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
				cost: 0.0012,
				tool_calls: [{ id: 'call_1', function: { name: 'read_note', arguments: '{"path":"todo.md"}' } }],
			},
			{
				id: 'msg_1791000200000_g7h8i9',
				role: 'tool',
				content: 'note contents',
				timestamp: 1791000200000,
				tool_call_id: 'call_1',
				tool_error: true,
				images: ['data:image/png;base64,AAAA'],
			},
		],
	};
}

test('serialize → parse round-trips a full conversation byte-for-byte in shape', () => {
	const conv = sampleConversation();
	const parsed = parseCurt(serializeCurt(conv));
	assert.ok(parsed);
	assert.deepEqual(parsed, conv);
});

test('serialized body carries the magic field and version', () => {
	const body = serializeCurt(sampleConversation());
	const data = JSON.parse(body);
	assert.equal(data.curt, CURT_FORMAT.magic);
	assert.equal(data.version, CURT_FORMAT.version);
	assert.equal(typeof data.conversation, 'object');
});

test('generator provenance: omitted by default, stamped when a version is given', () => {
	const unstamped = JSON.parse(serializeCurt(sampleConversation()));
	assert.equal('generator' in unstamped, false, 'no generator key without a version');

	const stamped = JSON.parse(serializeCurt(sampleConversation(), '0.2.0'));
	assert.equal(stamped.generator, 'curtis-ai-porter@0.2.0');

	// The plugin's readers ignore the field entirely — a stamped file parses
	// to the identical conversation.
	const parsed = parseCurt(serializeCurt(sampleConversation(), '0.2.0'));
	assert.ok(parsed);
	assert.deepEqual(parsed, sampleConversation());
});

test('swarm role/leaderId survive a .curt round-trip', () => {
	const conv = { ...sampleConversation(), role: 'follower' as const, leaderId: 'conv_1791000000000_lead0001' };
	const parsed = parseCurt(serializeCurt(conv));
	assert.ok(parsed);
	assert.equal(parsed.role, 'follower');
	assert.equal(parsed.leaderId, 'conv_1791000000000_lead0001');
});

test('agentId/skillIds survive .curt and markdown round-trips', () => {
	const sample = sampleConversation();
	sample.agentId = 'researcher';
	sample.skillIds = ['deep-research', 'vault-tidy'];
	sample.messages[1].agentId = 'researcher';

	const parsed = parseCurt(serializeCurt(sample));
	assert.ok(parsed);
	assert.equal(parsed.agentId, 'researcher');
	assert.deepEqual(parsed.skillIds, ['deep-research', 'vault-tidy']);
	assert.equal(parsed.messages[1].agentId, 'researcher');

	// The markdown projection carries the same provenance: agentId in the
	// frontmatter and the message marker, skillIds in the frontmatter.
	const reparsed = parseConversationMarkdown(serializeCurtisMarkdown(sample), 0);
	assert.ok(reparsed);
	assert.deepEqual(JSON.parse(JSON.stringify(reparsed)), JSON.parse(JSON.stringify(sample)));
});

test('parse rejects corrupt bodies', () => {
	assert.equal(parseCurt('not json'), null);
	assert.equal(parseCurt('{}'), null);
	assert.equal(parseCurt(JSON.stringify({ curt: 'other-magic', version: 1, conversation: {} })), null);
	assert.equal(parseCurt(JSON.stringify({ curt: CURT_FORMAT.magic, version: 2, conversation: {} })), null);
});

test('parse rejects conversations with invalid messages', () => {
	const conv = sampleConversation();
	const bad = JSON.parse(serializeCurt(conv));
	bad.conversation.messages[1].role = 'wizard';
	assert.equal(parseCurt(JSON.stringify(bad)), null);

	const noTs = JSON.parse(serializeCurt(conv));
	delete noTs.conversation.messages[0].timestamp;
	assert.equal(parseCurt(JSON.stringify(noTs)), null);

	const noId = JSON.parse(serializeCurt(conv));
	noId.conversation.id = 42;
	assert.equal(parseCurt(JSON.stringify(noId)), null);
});

test('parse accepts conversations with only the required fields', () => {
	const minimal = {
		curt: CURT_FORMAT.magic,
		version: 1,
		conversation: {
			id: 'conv_1_abc',
			title: 'T',
			createdAt: 1,
			updatedAt: 2,
			provider: '',
			model: '',
			messages: [{ id: 'msg_1_abc', role: 'user', content: 'hi', timestamp: 1 }],
		},
	};
	const parsed = parseCurt(JSON.stringify(minimal));
	assert.ok(parsed);
	assert.equal(parsed.messages.length, 1);
});
