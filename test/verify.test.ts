// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// verify.ts contract: native files parse and re-serialize byte-identical;
// damage and drift are reported, never repaired. The hand-edited-markdown
// case pins the proven invariant: prose appended inside a message body
// re-serializes to the same bytes (the parser trims only the region edges),
// so it stays canonical — while whitespace outside those edges does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCurt, serializeCurt, serializeCurtAs, CURT_FORMAT } from '../src/core/curt';
import { parseConversationMarkdown, serializeCurtisMarkdown } from '../src/core/curtis-md';
import { verifyCurt, verifyCurtisMarkdown } from '../src/core/verify';
import type { Conversation } from '../src/core/types';

// Timestamps deliberately out of message order — summary first/last must be
// min/max, not first-message/last-message.
function sampleConversation(): Conversation {
	return {
		id: 'conv_1791000000000_abc123def',
		title: 'Weekly review',
		createdAt: 1791000000000,
		updatedAt: 1791000600000,
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		messages: [
			{ id: 'msg_1791000100000_a1b2c3', role: 'user', content: 'Plan my week', timestamp: 1791000100000 },
			{ id: 'msg_1791000000000_d4e5f6', role: 'assistant', content: 'Here is a plan.', timestamp: 1791000000000 },
		],
	};
}

// A real wall-clock mtime for the vault file; canonical files never read it.
const FALLBACK_MTIME = 1791000900000;

const EXPECTED_SUMMARY = {
	id: 'conv_1791000000000_abc123def',
	title: 'Weekly review',
	messages: 2,
	first: 1791000000000,
	last: 1791000100000,
};

test('verifyCurt accepts a serialized conversation as canonical', () => {
	const result = verifyCurt(serializeCurt(sampleConversation()));
	assert.equal(result.format, 'curt');
	assert.equal(result.ok, true);
	assert.equal(result.canonical, true);
	assert.deepEqual(result.issues, []);
	assert.deepEqual(result.summary, EXPECTED_SUMMARY);
});

test('verifyCurtisMarkdown accepts a serialized transcript as canonical', () => {
	const result = verifyCurtisMarkdown(serializeCurtisMarkdown(sampleConversation()), FALLBACK_MTIME);
	assert.equal(result.format, 'curtis-md');
	assert.equal(result.ok, true);
	assert.equal(result.canonical, true);
	assert.deepEqual(result.issues, []);
	assert.deepEqual(result.summary, EXPECTED_SUMMARY);
});

test('verifyCurt reports a valid-JSON .curt with a bumped version as damaged', () => {
	const raw = JSON.stringify({ curt: CURT_FORMAT.magic, version: 2, conversation: sampleConversation() });
	const result = verifyCurt(raw);
	assert.equal(result.format, 'curt');
	assert.equal(result.ok, false);
	assert.equal(result.canonical, false);
	assert.ok(result.issues.length > 0);
	assert.equal(result.summary, undefined);
});

test('verifyCurt reports truncated JSON carrying the magic as a damaged .curt', () => {
	const result = verifyCurt('{"curt":"curtis-conversation","version":1,"conve');
	assert.equal(result.format, 'curt');
	assert.equal(result.ok, false);
	assert.ok(result.issues.length > 0);
});

test('verifyCurt reports a foreign (ChatGPT-shaped) JSON export as unknown', () => {
	const raw = JSON.stringify({
		title: 'Imported chat',
		mapping: { aaa: { message: { author: { role: 'user' }, content: { parts: ['hi'] } } } },
	});
	const result = verifyCurt(raw);
	assert.equal(result.format, 'unknown');
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues, ['not a native Curtis format']);
	assert.equal(result.summary, undefined);
});

test('verifyCurtisMarkdown reports Curtis frontmatter with an unreadable body as damaged', () => {
	const result = verifyCurtisMarkdown('---\ncurtis: conversation\n---\n\nno id, no markers\n', FALLBACK_MTIME);
	assert.equal(result.format, 'curtis-md');
	assert.equal(result.ok, false);
	assert.ok(result.issues.length > 0);
});

test('verifyCurtisMarkdown reports plain markdown as unknown', () => {
	const result = verifyCurtisMarkdown('# Just notes\n\nno frontmatter here\n', FALLBACK_MTIME);
	assert.equal(result.format, 'unknown');
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues, ['not a native Curtis format']);
});

test('prose appended to a message body stays canonical and deep-stable', () => {
	const raw = serializeCurtisMarkdown(sampleConversation());
	const edited = raw.replace('Plan my week', 'Plan my week\nand also water the plants');
	assert.notEqual(edited, raw);

	// The invariant, asserted directly: parse → serialize reproduces the
	// hand-edited bytes, because the edit sits inside the content region.
	assert.equal(serializeCurtisMarkdown(parseConversationMarkdown(edited, FALLBACK_MTIME)!), edited);

	const result = verifyCurtisMarkdown(edited, FALLBACK_MTIME);
	assert.equal(result.format, 'curtis-md');
	assert.equal(result.ok, true);
	assert.equal(result.canonical, true);
	assert.deepEqual(result.issues, []);

	const once = parseConversationMarkdown(edited, FALLBACK_MTIME);
	assert.ok(once);
	const twice = parseConversationMarkdown(serializeCurtisMarkdown(once), FALLBACK_MTIME);
	assert.ok(twice);
	assert.deepEqual(twice, once);
});

test('whitespace damage outside the content regions is valid but not canonical', () => {
	const raw = serializeCurtisMarkdown(sampleConversation());
	const damaged = `${raw}\n\n`;
	const result = verifyCurtisMarkdown(damaged, FALLBACK_MTIME);
	assert.equal(result.format, 'curtis-md');
	assert.equal(result.ok, true);
	assert.equal(result.canonical, false);
	assert.ok(result.issues.includes('valid but not byte-canonical — re-save to canonicalize'));
	assert.deepEqual(result.summary, EXPECTED_SUMMARY);
});

test('a marker without ts is reported as a file-mtime fallback', () => {
	const raw = serializeCurtisMarkdown(sampleConversation());
	const edited = raw.replace('"ts":1791000100000,"role":"user"', '"role":"user"');
	assert.notEqual(edited, raw);
	const result = verifyCurtisMarkdown(edited, FALLBACK_MTIME);
	assert.equal(result.ok, true);
	assert.ok(result.issues.includes('message 1 has no timestamp — fell back to file mtime'));
	// A genuine ts at the fallback value must NOT be flagged: the shifted
	// fallback diff only moves timestamps the file omitted.
	const intact = verifyCurtisMarkdown(raw, 1791000100000);
	assert.deepEqual(intact.issues, []);
});

test('verifyCurt reproduces the generator stamp the file itself carries', () => {
	// Porter-stamped output verifies canonical with no caller-side version.
	const porterStamped = verifyCurt(serializeCurt(sampleConversation(), '0.2.0'));
	assert.equal(porterStamped.ok, true);
	assert.equal(porterStamped.canonical, true);
	assert.deepEqual(porterStamped.issues, []);

	// Same for a plugin-stamped file: each first-party writer's canonical
	// output is judged against its own stamp, not this porter's.
	const pluginStamped = verifyCurt(serializeCurtAs(sampleConversation(), 'curtis-ai-chat@2.0.0'));
	assert.equal(pluginStamped.ok, true);
	assert.equal(pluginStamped.canonical, true);
	assert.deepEqual(pluginStamped.issues, []);

	// Unstamped output (pre-provenance writers) stays canonical too.
	const unstamped = verifyCurt(serializeCurt(sampleConversation()));
	assert.equal(unstamped.ok, true);
	assert.equal(unstamped.canonical, true);
	assert.deepEqual(unstamped.issues, []);
});

test('verifyCurt reports a reordered or non-string generator stamp as non-canonical', () => {
	// Canonical bytes assign generator last; a writer that emits it first is
	// valid (readers ignore the field, R1) but not byte-canonical.
	const reordered = JSON.stringify(
		{ generator: 'curtis-ai-porter@0.2.0', curt: CURT_FORMAT.magic, version: 1, conversation: sampleConversation() },
		null,
		'\t'
	);
	const reorderedResult = verifyCurt(reordered);
	assert.equal(reorderedResult.ok, true);
	assert.equal(reorderedResult.canonical, false);
	assert.ok(reorderedResult.issues.includes('valid but not byte-canonical — re-save to canonicalize'));

	// A non-typed stamp can't be reproduced by the canonical serializer —
	// valid, not canonical.
	const numeric = JSON.stringify(
		{ curt: CURT_FORMAT.magic, version: 1, conversation: sampleConversation(), generator: 42 },
		null,
		'\t'
	);
	const numericResult = verifyCurt(numeric);
	assert.equal(numericResult.ok, true);
	assert.equal(numericResult.canonical, false);
});

test('swarm role/leaderId survive the markdown round-trip and stay canonical', () => {
	const conv = { ...sampleConversation(), role: 'leader' as const, leaderId: 'conv_1791000000000_flw0001' };
	const raw = serializeCurtisMarkdown(conv);
	assert.match(raw, /^role: leader$/m);
	assert.match(raw, /^leaderId: conv_1791000000000_flw0001$/m);

	const parsed = parseConversationMarkdown(raw, FALLBACK_MTIME);
	assert.ok(parsed);
	assert.equal(parsed.role, 'leader');
	assert.equal(parsed.leaderId, 'conv_1791000000000_flw0001');
	// JSON-normalize: the parser leaves optional message fields explicitly
	// undefined where the sample omits them.
	assert.deepEqual(JSON.parse(JSON.stringify(parsed.messages)), JSON.parse(JSON.stringify(conv.messages)));

	const result = verifyCurtisMarkdown(raw, FALLBACK_MTIME);
	assert.equal(result.ok, true);
	assert.equal(result.canonical, true);
	assert.deepEqual(result.issues, []);
});

test('idempotence: verify(serialize(parse(raw))) is canonical for both formats', () => {
	const loosenedCurt = JSON.stringify(JSON.parse(serializeCurt(sampleConversation())), null, 2);
	const first = verifyCurt(loosenedCurt);
	assert.equal(first.ok, true);
	assert.equal(first.canonical, false);
	const parsed = parseCurt(loosenedCurt);
	assert.ok(parsed);
	const canonicalCurt = verifyCurt(serializeCurt(parsed));
	assert.equal(canonicalCurt.canonical, true);
	assert.deepEqual(canonicalCurt.issues, []);

	const damagedMd = `${serializeCurtisMarkdown(sampleConversation())}\n\n`;
	const parsedMd = parseConversationMarkdown(damagedMd, FALLBACK_MTIME);
	assert.ok(parsedMd);
	const canonicalMd = verifyCurtisMarkdown(serializeCurtisMarkdown(parsedMd), FALLBACK_MTIME);
	assert.equal(canonicalMd.format, 'curtis-md');
	assert.equal(canonicalMd.ok, true);
	assert.equal(canonicalMd.canonical, true);
	assert.deepEqual(canonicalMd.issues, []);
});
