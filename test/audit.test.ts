// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Audit receipt encoding — byte-compatibility with curtis-ai-audit's OM-1
// parser (vendored encoder) and the receipt payload shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	AUDIT_AGENT,
	canonicalJson,
	chatImportPayload,
	chatMessageId,
	encodeAuditBlock,
	escapeCommentTokens,
} from '../src/core/audit';

const CONV = {
	id: 'conv-123',
	title: '  Claudeway launch   planning  ',
	createdAt: 1750000000000,
	provider: 'anthropic',
	model: 'claude-sonnet-4',
	messages: [{}, {}, {}],
};

test('canonicalJson sorts keys and skips undefined', () => {
	assert.equal(canonicalJson({ b: 1, a: 2, c: undefined }), '{"a":2,"b":1}');
	assert.equal(canonicalJson({ a: [1, { b: 'x' }] }), '{"a":[1,{"b":"x"}]}');
});

test('escapeCommentTokens prevents early comment termination, round-trips', () => {
	const json = escapeCommentTokens(canonicalJson({ s: 'bad --> <!-- inject' }));
	assert.ok(!json.includes('-->'));
	assert.ok(!json.includes('<!--'));
	assert.deepEqual(JSON.parse(json), { s: 'bad --> <!-- inject' });
});

test('chatMessageId is stable and input-sensitive', () => {
	assert.equal(chatMessageId('conv-123'), chatMessageId('conv-123'));
	assert.notEqual(chatMessageId('conv-123'), chatMessageId('conv-124'));
	assert.ok(chatMessageId('conv-123').startsWith('msg_'));
});

test('chatImportPayload maps the conversation to audit.v1 fields', () => {
	const payload = chatImportPayload(CONV, 'AI/Conversations/Claudeway launch.md');
	assert.equal(payload.agent, AUDIT_AGENT);
	assert.equal(payload.agent, 'curtis-ai-porter');
	assert.equal(payload.action, 'chat-import');
	assert.equal(payload.status, 'ok');
	assert.equal(payload.subject, 'AI/Conversations/Claudeway launch.md');
	assert.equal(payload.summary, 'Claudeway launch planning');
	assert.equal(payload.ts, new Date(1750000000000).toISOString());
	assert.deepEqual(payload.detail, { provider: 'anthropic', model: 'claude-sonnet-4', messageCount: 3 });
	// whole payload must be JSON-serializable without throwing
	JSON.stringify(payload);
});

test('chatImportPayload omits ts for a garbage creation date', () => {
	const payload = chatImportPayload({ ...CONV, createdAt: Number.NaN }, 'x.md');
	assert.equal('ts' in payload, false);
});

test('encodeAuditBlock emits the OM-1 shape curtis-ai-audit parses', () => {
	const payload = chatImportPayload(CONV, 'x.md');
	const block = encodeAuditBlock(chatMessageId(CONV.id), payload);
	const lines = block.split('\n');
	assert.ok(lines[0].startsWith('<!-- messenger: {'));
	assert.ok(lines[0].endsWith('-->'));
	// block ends "\n\n": the marker line, then two empty trailing entries
	assert.ok(lines[lines.length - 3] === '<!-- /messenger -->');
	assert.ok(lines[lines.length - 1] === '');
	assert.ok(block.endsWith('\n\n'));

	// header line is "<!-- messenger: <envelope> -->" — 4-char close
	const header = JSON.parse(lines[0].slice('<!-- messenger: '.length, -4));
	assert.equal(header.from, 'curtis-ai-porter');
	assert.equal(header.to, 'audit');
	assert.equal(header.replyTo, null);
	assert.deepEqual(JSON.parse(lines[1]), payload);

	// stable id in the envelope — re-runs dedupe instead of duplicating
	const again = encodeAuditBlock(chatMessageId(CONV.id), payload);
	assert.equal(JSON.parse(again.split('\n')[0].slice('<!-- messenger: '.length, -4)).id, header.id);
});
