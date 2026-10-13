// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// The contract assertions, parameterized over a Curtis parser pair.
// Run once against the vendored reference snapshot (always), and once
// against the live plugin repo when it's checked out next door — two
// independent implementations of the format must agree with the porter.
//
// Tests tagged [R#] / [W#] map to the reader/writer compatibility rules in
// docs/curt-format.md — the spec is the contract, this suite is its proof.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parse as parseYaml, stringify as yamlStringify } from 'yaml';
import { convertFiles } from '../src/core/convert';
import type { Conversation } from '../src/core/types';

/** YAML codec shape the transcript parsers accept (the plugin's YamlPort;
 *  both implementations take it structurally). */
export interface CurtisYaml {
	parse(text: string): unknown;
	dump(value: unknown): string;
}

export interface CurtisParsers {
	parseCurt: (raw: string) => Conversation | null;
	parseConversationMarkdown: (raw: string, fallbackMtime: number, yaml: CurtisYaml) => Conversation | null;
}

function zipBuffer(entries: Record<string, Uint8Array>): ArrayBuffer {
	const zipped = zipSync(entries);
	return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function chatgptZip(): ArrayBuffer {
	const conversations = [
		{
			title: 'Event loop deep dive',
			create_time: 1700000000,
			update_time: 1700000500,
			mapping: {
				root: {},
				u1: { message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['How do microtasks work?'] }, create_time: 1700000000 } },
				a1: {
					message: {
						author: { role: 'assistant' },
						content: { content_type: 'text', parts: ['Microtasks run after each macrotask…'] },
						create_time: 1700000010,
						metadata: { model_slug: 'gpt-4o' },
					},
				},
				u2: { message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['And queues?'] }, create_time: 1700000020 } },
				a2: { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Same loop, different queue.'] }, create_time: 1700000030 } },
			},
		},
	];
	return zipBuffer({ 'conversations.json': strToU8(JSON.stringify(conversations)) });
}

function claudeJson(): ArrayBuffer {
	const conversations = [
		{
			name: 'Travel itinerary',
			created_at: '2026-08-15T09:00:00Z',
			updated_at: '2026-08-15T09:10:00Z',
			chat_messages: [
				{ sender: 'human', text: 'Three days in Lisbon?', created_at: '2026-08-15T09:00:00Z' },
				{
					sender: 'assistant',
					content: [
						{ type: 'text', text: 'Day 1: Alfama.' },
						{ type: 'text', text: 'Day 2: Belém.' },
					],
					created_at: '2026-08-15T09:05:00Z',
				},
			],
		},
	];
	return new TextEncoder().encode(JSON.stringify(conversations)).buffer as ArrayBuffer;
}

function pastedTranscript(): ArrayBuffer {
	const md = `# Weekend planning

## You

Can you help me plan Saturday?

## AI

Gladly — what's the group?
`;
	return new TextEncoder().encode(md).buffer as ArrayBuffer;
}

/** A Curtis-native .curt export, authored as data the way the plugin writes
 *  it, whose assistant turn used two memory facts. `memoriesUsedIds` is the
 *  Curtis 2.0 field: ids of the facts injected into that turn's system prompt. */
function curtWithMemories(): ArrayBuffer {
	const file = {
		curt: 'curtis-conversation',
		version: 1,
		conversation: {
			id: 'conv_1700000000000_memofact9',
			title: 'Memory facts demo',
			messages: [
				{
					id: 'msg_1700000000000_uaa01x',
					role: 'user',
					content: 'What do you remember about my project?',
					timestamp: 1700000000000,
				},
				{
					id: 'msg_1700000000100_ai01bx',
					role: 'assistant',
					content: 'You are building an Obsidian plugin with a file-backed store.',
					timestamp: 1700000000100,
					memoriesUsedIds: ['fact_1', 'fact_2'],
				},
			],
			createdAt: 1700000000000,
			updatedAt: 1700000000100,
			provider: 'openai',
			model: 'gpt-4o',
		},
	};
	return new TextEncoder().encode(JSON.stringify(file, null, '\t')).buffer as ArrayBuffer;
}

/** Register the contract suite against one parser pair. `label` keeps the
 *  vendored and live runs distinguishable in test output. */
export function registerContractSuite(label: string, curtis: CurtisParsers): void {
	const { parseCurt, parseConversationMarkdown } = curtis;
	// Standalone YAML codec for the transcript parser — the flat frontmatter
	// this format uses parses identically under Obsidian's js-yaml and the
	// 'yaml' package the porter bundles.
	const yamlPort: CurtisYaml = { parse: parseYaml, dump: yamlStringify };

	test(`[${label}] porter .curt output is accepted by Curtis parseCurt`, () => {
		const reports = convertFiles([{ name: 'export.zip', buffer: chatgptZip() }]);
		const [chat] = reports[0].chats;
		assert.ok(chat, 'conversion produced a chat');

		const roundTripped = parseCurt(chat.curt);
		assert.ok(roundTripped, 'Curtis accepts the .curt body');
		assert.equal(roundTripped.title, 'Event loop deep dive');
		assert.equal(roundTripped.provider, 'chatgpt');
		assert.equal(roundTripped.model, 'gpt-4o');
		assert.equal(roundTripped.messages.length, 4);
		assert.equal(roundTripped.messages[0].content, 'How do microtasks work?');
		assert.equal(roundTripped.messages[1].model, 'gpt-4o');
		// Ids match Curtis conventions.
		assert.match(roundTripped.id, /^conv_\d+_[0-9a-z]{9}$/);
		assert.match(roundTripped.messages[0].id, /^msg_\d+_[0-9a-z]{6}$/);
	});

	test(`[${label}] porter markdown output is accepted by Curtis transcript parser`, () => {
		const reports = convertFiles([{ name: 'export.zip', buffer: chatgptZip() }]);
		const [chat] = reports[0].chats;

		const roundTripped = parseConversationMarkdown(chat.markdown, 0, yamlPort);
		assert.ok(roundTripped, 'Curtis parses the markdown transcript');
		assert.equal(roundTripped.id, chat.conversation.id);
		assert.equal(roundTripped.title, 'Event loop deep dive');
		assert.equal(roundTripped.provider, 'chatgpt');
		assert.deepEqual(
			roundTripped.messages.map((m) => [m.role, m.content]),
			chat.conversation.messages.map((m) => [m.role, m.content])
		);
		assert.deepEqual(
			roundTripped.messages.map((m) => m.timestamp),
			chat.conversation.messages.map((m) => m.timestamp)
		);
	});

	test(`[${label}] Claude exports flow through end to end`, () => {
		const reports = convertFiles([{ name: 'conversations.json', buffer: claudeJson() }]);
		const [chat] = reports[0].chats;
		assert.equal(reports[0].format, 'claude');

		const roundTripped = parseCurt(chat.curt);
		assert.ok(roundTripped);
		assert.equal(roundTripped.title, 'Travel itinerary');
		assert.equal(roundTripped.messages[1].content, 'Day 1: Alfama.\nDay 2: Belém.');
		assert.equal(roundTripped.createdAt, Date.parse('2026-08-15T09:00:00Z'));
	});

	test(`[${label}] pasted transcripts (DeepSeek-style) flow through end to end`, () => {
		const reports = convertFiles([{ name: 'pasted-transcript.txt', buffer: pastedTranscript() }]);
		assert.equal(reports[0].format, 'generic-md');
		const [chat] = reports[0].chats;
		assert.ok(chat, 'paste produced a chat');

		const roundTripped = parseCurt(chat.curt);
		assert.ok(roundTripped);
		assert.equal(roundTripped.title, 'Weekend planning');
		assert.deepEqual(
			roundTripped.messages.map((m) => m.role),
			['user', 'assistant']
		);
	});

	test(`[${label}] .curt output reparses to an identical conversation`, () => {
		const first = convertFiles([{ name: 'export.zip', buffer: chatgptZip() }]);
		const original = first[0].chats[0];

		const roundTripped = parseCurt(original.curt);
		assert.ok(roundTripped);
		// JSON-normalize: the fresh conversation may carry explicit
		// `model: undefined` fields that serialization (correctly) drops.
		assert.deepEqual(JSON.parse(JSON.stringify(roundTripped)), JSON.parse(JSON.stringify(original.conversation)));
	});

	test(`[${label}] markdown output reparses to an identical conversation`, () => {
		const first = convertFiles([{ name: 'export.zip', buffer: chatgptZip() }]);
		const original = first[0].chats[0];

		const roundTripped = parseConversationMarkdown(original.markdown, 0, yamlPort);
		assert.ok(roundTripped);
		assert.deepEqual(JSON.parse(JSON.stringify(roundTripped)), JSON.parse(JSON.stringify(original.conversation)));
	});

	test(`[${label}] memoriesUsedIds survives .curt and markdown round-trips`, () => {
		const reports = convertFiles([{ name: 'memory-chat.curt', buffer: curtWithMemories() }]);
		assert.equal(reports[0].format, 'curt');
		const [chat] = reports[0].chats;
		assert.ok(chat, 'conversion produced a chat');
		assert.deepEqual(chat.conversation.messages[1].memoriesUsedIds, ['fact_1', 'fact_2']);

		// .curt output: the vendored parser reads the field back verbatim.
		const fromCurt = parseCurt(chat.curt);
		assert.ok(fromCurt, 'Curtis accepts the .curt body');
		assert.deepEqual(fromCurt.messages[1].memoriesUsedIds, ['fact_1', 'fact_2']);
		assert.equal(fromCurt.messages[0].memoriesUsedIds, undefined);

		// Markdown output: the vendored transcript parser reads marker meta key
		// `mem` back into memoriesUsedIds; the message without the field stays
		// without one (JSON-normalize drops the undefined key both sides).
		const fromMd = parseConversationMarkdown(chat.markdown, 0, yamlPort);
		assert.ok(fromMd, 'Curtis parses the markdown transcript');
		assert.deepEqual(JSON.parse(JSON.stringify(fromMd)), JSON.parse(JSON.stringify(chat.conversation)));
	});

	/** A Curtis-native .curt export authored as the plugin's 2.0.0 swarm shape:
	 *  a follower chat driven by a leader (`role` + `leaderId` on the
	 *  conversation), stamped with the plugin's `generator` provenance. */
	function curtWithSwarm(): ArrayBuffer {
		const file = {
			curt: 'curtis-conversation',
			version: 1,
			generator: 'curtis-ai-chat@2.0.0',
			conversation: {
				id: 'conv_1700000000000_swarmfl01',
				title: 'Swarm follower',
				role: 'follower',
				leaderId: 'conv_1700000000000_swarmld01',
				messages: [
					{
						id: 'msg_1700000000000_swarmu01',
						role: 'user',
						content: 'Summarize what the leader asked.',
						timestamp: 1700000000000,
					},
				],
				createdAt: 1700000000000,
				updatedAt: 1700000000000,
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
			},
		};
		return new TextEncoder().encode(JSON.stringify(file, null, '\t')).buffer as ArrayBuffer;
	}

	test(`[${label}] swarm role/leaderId and the generator stamp survive round-trips`, () => {
		const reports = convertFiles([{ name: 'swarm.curt', buffer: curtWithSwarm() }]);
		assert.equal(reports[0].format, 'curt');
		const [chat] = reports[0].chats;
		assert.ok(chat, 'conversion produced a chat');
		assert.equal(chat.conversation.role, 'follower');
		assert.equal(chat.conversation.leaderId, 'conv_1700000000000_swarmld01');

		// .curt output: the plugin-side parser reads the fields back verbatim.
		const fromCurt = parseCurt(chat.curt);
		assert.ok(fromCurt, 'Curtis accepts the .curt body');
		assert.deepEqual(JSON.parse(JSON.stringify(fromCurt)), JSON.parse(JSON.stringify(chat.conversation)));

		// Markdown output: role/leaderId move through the frontmatter contract.
		const fromMd = parseConversationMarkdown(chat.markdown, 0, yamlPort);
		assert.ok(fromMd, 'Curtis parses the markdown transcript');
		assert.equal(fromMd.role, 'follower');
		assert.equal(fromMd.leaderId, 'conv_1700000000000_swarmld01');
		assert.deepEqual(JSON.parse(JSON.stringify(fromMd)), JSON.parse(JSON.stringify(chat.conversation)));
	});

	/** A Curtis-native .curt export authored as the plugin's 2.0.1 agent/skill
	 *  shape: the conversation is bound to an agent with pinned skills
	 *  (`agentId` + `skillIds` on the conversation, `agentId` on the message
	 *  that turn produced), stamped with the plugin's `generator` provenance. */
	function curtWithAgents(): ArrayBuffer {
		const file = {
			curt: 'curtis-conversation',
			version: 1,
			generator: 'curtis-ai-chat@2.0.1',
			conversation: {
				id: 'conv_1700000000000_agentcn01',
				title: 'Agent-bound chat',
				agentId: 'researcher',
				skillIds: ['deep-research', 'vault-tidy'],
				messages: [
					{
						id: 'msg_1700000000000_agentu01',
						role: 'user',
						content: 'Find what changed in the spec.',
						timestamp: 1700000000000,
					},
					{
						id: 'msg_1700000000100_agenta02',
						role: 'assistant',
						content: 'The markdown projection now carries agent provenance.',
						timestamp: 1700000000100,
						agentId: 'researcher',
					},
				],
				createdAt: 1700000000000,
				updatedAt: 1700000000100,
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
			},
		};
		return new TextEncoder().encode(JSON.stringify(file, null, '\t')).buffer as ArrayBuffer;
	}

	test(`[${label}] agentId/skillIds survive .curt and markdown round-trips`, () => {
		const reports = convertFiles([{ name: 'agent-chat.curt', buffer: curtWithAgents() }]);
		assert.equal(reports[0].format, 'curt');
		const [chat] = reports[0].chats;
		assert.ok(chat, 'conversion produced a chat');
		assert.equal(chat.conversation.agentId, 'researcher');
		assert.deepEqual(chat.conversation.skillIds, ['deep-research', 'vault-tidy']);
		assert.equal(chat.conversation.messages[1].agentId, 'researcher');

		// .curt output: the plugin-side parser reads the fields back verbatim.
		const fromCurt = parseCurt(chat.curt);
		assert.ok(fromCurt, 'Curtis accepts the .curt body');
		assert.deepEqual(JSON.parse(JSON.stringify(fromCurt)), JSON.parse(JSON.stringify(chat.conversation)));

		// Markdown output: agentId rides the frontmatter and the marker meta,
		// skillIds the frontmatter; a message without the field stays without.
		const fromMd = parseConversationMarkdown(chat.markdown, 0, yamlPort);
		assert.ok(fromMd, 'Curtis parses the markdown transcript');
		assert.equal(fromMd.agentId, 'researcher');
		assert.deepEqual(fromMd.skillIds, ['deep-research', 'vault-tidy']);
		assert.equal(fromMd.messages[1].agentId, 'researcher');
		assert.equal(fromMd.messages[0].agentId, undefined);
		assert.deepEqual(JSON.parse(JSON.stringify(fromMd)), JSON.parse(JSON.stringify(chat.conversation)));
	});

	// -- Spec conformance (docs/curt-format.md) ------------------------------
	// Tests tagged [R#] / [W#] pin the spec's compatibility rules. The two
	// escaping rules and the strict-rejection behavior are the edges most
	// likely to drift between implementations, so they are pinned explicitly.

	/** Wrap a full envelope object as a .curt file buffer, tab-indented the
	 *  way first-party writers emit it. */
	function curtBuffer(file: Record<string, unknown>): ArrayBuffer {
		return new TextEncoder().encode(JSON.stringify(file, null, '\t')).buffer as ArrayBuffer;
	}

	function specConversation(): Record<string, unknown> & { messages: Record<string, unknown>[] } {
		return {
			id: 'conv_1700000000000_specfn01',
			title: 'Spec conformance',
			messages: [
				{ id: 'msg_1700000000000_spa01x', role: 'user', content: 'Hello', timestamp: 1700000000000 },
				{ id: 'msg_1700000000100_spb02x', role: 'assistant', content: 'Hi back', timestamp: 1700000000100 },
			],
			createdAt: 1700000000000,
			updatedAt: 1700000000100,
			provider: 'test',
			model: 'test-model',
		};
	}

	test(`[${label}] [R1] readers ignore the generator stamp entirely`, () => {
		const bare = { curt: 'curtis-conversation', version: 1, conversation: specConversation() };
		const stamped = { ...bare, generator: 'weird-writer@9.9.9-not-curtis' };
		const a = parseCurt(new TextDecoder().decode(curtBuffer(bare)));
		const b = parseCurt(new TextDecoder().decode(curtBuffer(stamped)));
		assert.ok(a, 'unversioned file parses');
		assert.ok(b, 'foreign-stamped file parses');
		assert.deepEqual(b, a, 'generator presence and value never affect parsing');
	});

	test(`[${label}] [R2] the .curt reader passes unknown fields through untouched`, () => {
		const conv = specConversation();
		conv.originTag = 'migration-2026';
		(conv.messages[0] as Record<string, unknown>).xCustom = 'keepme';
		const raw = JSON.stringify({ curt: 'curtis-conversation', version: 1, conversation: conv }, null, '\t');
		const parsed = parseCurt(raw) as unknown as Record<string, any>;
		assert.ok(parsed, 'unknown fields do not reject the file');
		assert.equal(parsed.originTag, 'migration-2026');
		assert.equal(parsed.messages[0].xCustom, 'keepme');
	});

	test(`[${label}] [R3] readers reject damaged files instead of salvaging`, () => {
		const good = { curt: 'curtis-conversation', version: 1, conversation: specConversation() };
		assert.equal(parseCurt(''), null);
		assert.equal(parseCurt('not json at all'), null);
		assert.equal(parseCurt(JSON.stringify({ ...good, curt: 'something-else' })), null, 'wrong magic');
		assert.equal(parseCurt(JSON.stringify({ ...good, version: 2 })), null, 'wrong version');
		const missingTs = JSON.parse(JSON.stringify(good));
		delete (missingTs.conversation.messages[1] as Record<string, unknown>).timestamp;
		assert.equal(parseCurt(JSON.stringify(missingTs)), null, 'message missing a required field');

		assert.equal(parseConversationMarkdown('no frontmatter here', 0, yamlPort), null);
		assert.equal(parseConversationMarkdown('---\nprovider: test\n---\n\n# T\n', 0, yamlPort), null, 'missing curtis signature');
		assert.equal(parseConversationMarkdown('---\ncurtis: conversation\nid: [1,2]\n---\n\n# T\n', 0, yamlPort), null, 'id must be a string');
	});

	test(`[${label}] [R5] a malformed marker is content, not a boundary`, () => {
		const md = [
			'---',
			'curtis: conversation',
			'id: conv_1700000000000_r5test001',
			'created: 1700000000000',
			'updated: 1700000000000',
			'provider: test',
			'model: test-model',
			'---',
			'',
			'# Broken markers',
			'',
			'## You',
			'<!-- curtis:msg {"id":"msg_1700000000000_r5a01x","ts":1700000000000,"role":"user"} -->',
			'',
			'Before the broken marker.',
			'<!-- curtis:msg {"id":"oops" no closing brace',
			'',
			'## AI',
			'<!-- curtis:msg {"id":"msg_1700000000000_r5b02x","ts":1700000000001,"role":"assistant"} -->',
			'',
			'After.',
			'',
		].join('\n');
		const parsed = parseConversationMarkdown(md, 0, yamlPort);
		assert.ok(parsed, 'file still parses');
		assert.equal(parsed.messages.length, 1, 'no message invented from the broken marker');
		assert.ok(parsed.messages[0].content.includes('no closing brace'), 'broken marker text stays as content');
		// The lazy marker regex reaches across the broken opener and swallows
		// the next valid one — both end up as content of the preceding message.
		// That reach is part of the contract, not an accident to "fix" here.
		assert.ok(parsed.messages[0].content.includes('After.'), 'the swallowed block stays readable');
	});

	test(`[${label}] [R5] a role-less marker bounds content but ingests nothing`, () => {
		const md = [
			'---',
			'curtis: conversation',
			'id: conv_1700000000000_r5test002',
			'created: 1700000000000',
			'updated: 1700000000000',
			'provider: test',
			'model: test-model',
			'---',
			'',
			'# Role-less marker',
			'',
			'## You',
			'<!-- curtis:msg {"id":"msg_1700000000000_r5c03x","ts":1700000000000,"role":"user"} -->',
			'',
			'Real message.',
			'',
			'<!-- curtis:msg {"id":"msg_1700000000000_r5d04x","ts":1700000000001} -->',
			'',
			'## AI',
			'<!-- curtis:msg {"id":"msg_1700000000000_r5e05x","ts":1700000000002,"role":"assistant"} -->',
			'',
			'Reply.',
			'',
		].join('\n');
		const parsed = parseConversationMarkdown(md, 0, yamlPort);
		assert.ok(parsed);
		assert.deepEqual(
			parsed.messages.map((m) => [m.role, m.content]),
			[
				['user', 'Real message.'],
				['assistant', 'Reply.'],
			]
		);
	});

	test(`[${label}] [W4] marker JSON containing --> escapes and round-trips`, () => {
		const conv = specConversation();
		(conv.messages[0] as Record<string, unknown>).attachedNotes = ['Notes/Weird --> name.md'];
		const reports = convertFiles([
			{ name: 'escaping.curt', buffer: curtBuffer({ curt: 'curtis-conversation', version: 1, conversation: conv }) },
		]);
		assert.equal(reports[0].format, 'curt');
		const [chat] = reports[0].chats;
		assert.ok(chat, 'conversion produced a chat');

		assert.ok(chat.markdown.includes('--\\u003E'), 'writer escapes --> inside marker JSON');
		const parsed = parseConversationMarkdown(chat.markdown, 0, yamlPort);
		assert.ok(parsed, 'escaped marker still parses');
		assert.deepEqual(parsed.messages[0].attachedNotes, ['Notes/Weird --> name.md'], 'reader restores the real bytes');
	});

	test(`[${label}] [W4] a quoted marker opener cannot split a message`, () => {
		const tricky = 'Quoting it: <!-- curtis:msg {"id":"fake","ts":1,"role":"user"} --> inline';
		const conv = specConversation();
		(conv.messages[1] as Record<string, unknown>).content = tricky;
		const reports = convertFiles([
			{ name: 'quoted-marker.curt', buffer: curtBuffer({ curt: 'curtis-conversation', version: 1, conversation: conv }) },
		]);
		const [chat] = reports[0].chats;
		assert.ok(chat, 'conversion produced a chat');

		const fromCurt = parseCurt(chat.curt);
		assert.ok(fromCurt);
		assert.equal(fromCurt.messages[1].content, tricky, 'the .curt envelope is lossless');

		assert.ok(chat.markdown.includes('<!--\u200Bcurtis:msg'), 'writer neutralizes the opener with U+200B');
		const parsed = parseConversationMarkdown(chat.markdown, 0, yamlPort);
		assert.ok(parsed);
		assert.equal(parsed.messages.length, 2, 'neutralized marker does not become a boundary');
		assert.equal(parsed.messages[1].content, tricky.replace('<!-- curtis:msg', '<!--\u200Bcurtis:msg'), 'the ZWSP survives the round-trip');
	});

	test(`[${label}] [W5] unknown fields ride .curt but not the markdown projection`, () => {
		const conv = specConversation();
		conv.originTag = 'migration-2026';
		(conv.messages[0] as Record<string, unknown>).xCustom = 'keepme';
		const reports = convertFiles([
			{ name: 'extra-fields.curt', buffer: curtBuffer({ curt: 'curtis-conversation', version: 1, conversation: conv }) },
		]);
		const [chat] = reports[0].chats;
		assert.ok(chat, 'conversion produced a chat');

		const fromCurt = parseCurt(chat.curt) as unknown as Record<string, any>;
		assert.ok(fromCurt);
		assert.equal(fromCurt.originTag, 'migration-2026', 'the .curt envelope is lossless');
		assert.equal(fromCurt.messages[0].xCustom, 'keepme');

		const parsed = parseConversationMarkdown(chat.markdown, 0, yamlPort) as unknown as Record<string, any>;
		assert.ok(parsed, 'the projection still parses');
		assert.equal(parsed.originTag, undefined, 'unknown conversation fields are not carried by markdown');
		assert.equal(parsed.messages[0].xCustom, undefined, 'unknown message fields are not carried by markdown');
	});
}
