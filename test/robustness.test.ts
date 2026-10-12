// Adversarial-input robustness: filename sanitization (long titles, Windows
// reserved names, crafted ids), run-wide output-name uniqueness, NaN
// timestamp guards, UTF-16 export decoding, and the zip decompression
// preflight. Nothing here changes detection semantics for valid inputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { detectAndParse, parsedChatToConversation } from '../src/core/detect';
import { sanitizeFilename } from '../src/core/curt';
import { vaultFileNameFor } from '../src/core/curtis-md';
import { convertFiles, allChats } from '../src/core/convert';
import type { ConvertedChat, Conversation } from '../src/core/types';

// ---- Fixtures ---------------------------------------------------------------

interface ChatGptConv {
	title: string;
	create_time: number;
	mapping: Record<string, unknown>;
}

function chatgptExportJson(title: string): ChatGptConv[] {
	return [
		{
			title,
			create_time: 1700000000,
			mapping: {
				a: { message: { author: { role: 'user' }, content: { parts: ['question'] }, create_time: 1700000000 } },
				b: { message: { author: { role: 'assistant' }, content: { parts: ['answer'] }, create_time: 1700000010 } },
			},
		},
	];
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function utf8Buf(s: string): ArrayBuffer {
	return toArrayBuffer(new TextEncoder().encode(s));
}

function curtBuf(id: string, title: string, content: string): ArrayBuffer {
	const file = {
		curt: 'curtis-conversation',
		version: 1,
		conversation: {
			id,
			title,
			createdAt: 1700000000000,
			updatedAt: 1700000000000,
			provider: 'openai',
			model: 'gpt-4o',
			messages: [{ id: 'msg_1700000000000_aaa111', role: 'user', content, timestamp: 1700000000000 }],
		},
	};
	return utf8Buf(JSON.stringify(file, null, '\t'));
}

/** Real UTF-16 bytes (code units) with the given BOM — TextEncoder only does
 *  UTF-8, so the payload is emitted as 16-bit code units (ASCII payload). */
function utf16Buf(s: string, be: boolean): ArrayBuffer {
	const out = new Uint8Array(2 + s.length * 2);
	out[0] = be ? 0xfe : 0xff;
	out[1] = be ? 0xff : 0xfe;
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (be) {
			out[2 + i * 2] = code >> 8;
			out[3 + i * 2] = code & 0xff;
		} else {
			out[2 + i * 2] = code & 0xff;
			out[3 + i * 2] = code >> 8;
		}
	}
	return toArrayBuffer(out);
}

const claudeJson =
	'[{"name":"U16 chat","created_at":"2026-01-01T10:00:00Z","updated_at":"2026-01-01T10:05:00Z",' +
	'"chat_messages":[' +
	'{"sender":"human","text":"hello utf16","created_at":"2026-01-01T10:00:00Z"},' +
	'{"sender":"assistant","text":"hi back","created_at":"2026-01-01T10:01:00Z"}]}]';

// ---- sanitizeFilename -------------------------------------------------------

test('sanitizeFilename: caps the stem at 100 chars and stays valid', () => {
	const out = sanitizeFilename('x'.repeat(300));
	assert.equal(out.length, 100);
	const withExt = `${out}.curt`;
	assert.ok(withExt.length < 255, 'filename stays within common length limits');

	// A cut that lands on a trailing dot/space must not leave one behind.
	const cut = sanitizeFilename('a'.repeat(99) + '.');
	assert.equal(cut, 'a'.repeat(99));
});

test('sanitizeFilename: strips trailing dots and suffixes Windows reserved names', () => {
	assert.equal(sanitizeFilename('Hello.'), 'Hello');
	assert.equal(sanitizeFilename('CON'), 'CON_');
	assert.equal(sanitizeFilename('con'), 'con_');
	assert.equal(sanitizeFilename('Com1'), 'Com1_');
	assert.equal(sanitizeFilename('lpt9'), 'lpt9_');
	assert.equal(sanitizeFilename('AUX'), 'AUX_');
	// Normal names are untouched.
	assert.equal(sanitizeFilename('Lisbon weekend'), 'Lisbon weekend');
	assert.equal(sanitizeFilename(''), 'conversation');
});

// ---- hostile ids in filenames ----------------------------------------------

test('vaultFileNameFor: a crafted id like "a_b/c" yields a safe filename', () => {
	const conv: Conversation = {
		id: 'a_b/c',
		title: 'Hostile id',
		messages: [],
		createdAt: 1700000000000,
		updatedAt: 1700000000000,
		provider: '',
		model: '',
	};
	const name = vaultFileNameFor(conv);
	assert.ok(!/[\\/]/.test(name), `no path separators in ${name}`);
	assert.ok(!name.includes('..'));
	assert.ok(name.endsWith(' b_c.md'));
});

test('vaultFileNameFor: non-finite createdAt cannot reach the filename', () => {
	const name = vaultFileNameFor({
		id: 'conv_1_abc',
		title: 'T',
		messages: [],
		createdAt: Number.NaN,
		updatedAt: Number.NaN,
		provider: '',
		model: '',
	});
	assert.match(name, /^\d{4}-\d{2}-\d{2} T abc\.md$/);
	assert.ok(!name.includes('NaN'));
});

test('convertFiles: hostile .curt ids never leak / or .. into output names', () => {
	const reports = convertFiles([{ name: 'hostile.curt', buffer: curtBuf('a_b/c', 'Hostile id', 'hi') }]);
	assert.equal(reports[0].format, 'curt');
	assert.equal(reports[0].chats.length, 1);
	for (const name of [reports[0].chats[0].files.curt, reports[0].chats[0].files.md]) {
		assert.ok(!/[\\/]/.test(name), `no path separators in ${name}`);
		assert.ok(!name.includes('..'), `no dot-dot segments in ${name}`);
	}
	assert.equal(reports[0].chats[0].files.curt, 'Hostile id.curt');
	assert.match(reports[0].chats[0].files.md, /^\d{4}-\d{2}-\d{2} Hostile id b_c\.md$/);
});

// ---- run-wide output-name uniqueness ---------------------------------------

test('convertFiles: same-titled chats from DIFFERENT input files both survive', () => {
	const reports = convertFiles([
		{ name: 'one.curt', buffer: curtBuf('conv_1700000000000_aaa111', 'Same title', 'first content') },
		{ name: 'two.curt', buffer: curtBuf('conv_1700000000001_bbb222', 'Same title', 'second content') },
	]);
	assert.equal(reports.length, 2);
	assert.equal(reports[0].skipped, 0);
	assert.equal(reports[1].skipped, 0);
	const names = allChats(reports).map((c) => c.files.curt);
	assert.equal(names.length, 2);
	assert.notEqual(names[0], names[1]);
	// First taker keeps the bare name; the clash gets the id6 suffix.
	assert.equal(names[0], 'Same title.curt');
	assert.equal(names[1], 'Same title bbb222.curt');
	const mdNames = allChats(reports).map((c) => c.files.md);
	assert.notEqual(mdNames[0], mdNames[1]);
	// Contents are both present, not overwritten.
	assert.deepEqual(allChats(reports).map((c) => c.conversation.messages[0].content), ['first content', 'second content']);
});

test('convertFiles: same-titled chats within one file still disambiguate', () => {
	const doc = [
		{ title: 'Clash', create_time: 1700000000, mapping: chatgptExportJson('Clash')[0].mapping },
		{
			title: 'Clash',
			create_time: 1700000001,
			mapping: {
				a: { message: { author: { role: 'user' }, content: { parts: ['different'] }, create_time: 1700000001 } },
				b: { message: { author: { role: 'assistant' }, content: { parts: ['stuff'] }, create_time: 1700000002 } },
			},
		},
	];
	const reports = convertFiles([{ name: 'conversations.json', buffer: utf8Buf(JSON.stringify(doc)) }]);
	assert.equal(reports[0].chats.length, 2);
	const names = reports[0].chats.map((c) => c.files.curt);
	assert.equal(names[0], 'Clash.curt');
	assert.match(names[1], /^Clash [0-9a-z]{6}\.curt$/);
	assert.notEqual(names[0], names[1]);
});

test('convertFiles: the uniqueness map resets per call', () => {
	const input = [{ name: 'one.curt', buffer: curtBuf('conv_1700000000000_aaa111', 'Fresh run', 'content') }];
	const first = convertFiles(input);
	const second = convertFiles(input);
	assert.equal(first[0].chats[0].files.curt, 'Fresh run.curt');
	assert.equal(second[0].chats[0].files.curt, 'Fresh run.curt');
});

// ---- NaN timestamp guards ---------------------------------------------------

test('parsedChatToConversation: NaN timestamps fall back to finite values', () => {
	const conv = parsedChatToConversation({
		title: 'T',
		messages: [
			{ role: 'user', content: 'q', timestamp: Number.NaN },
			{ role: 'assistant', content: 'a', timestamp: 1700000010000 },
		],
		createdAt: Number.NaN,
		updatedAt: undefined,
	});
	assert.ok(Number.isFinite(conv.createdAt));
	assert.ok(Number.isFinite(conv.updatedAt));
	assert.ok(conv.messages.every((m) => Number.isFinite(m.timestamp)));
	assert.equal(conv.messages[1].timestamp, 1700000010000);
});

test('ChatGPT export with non-numeric create_time yields finite timestamps and a real date filename', () => {
	const doc = [
		{
			title: 'Guard chat',
			create_time: 'garbage',
			mapping: {
				a: { message: { author: { role: 'user' }, content: { parts: ['q'] }, create_time: 1700000000 } },
				b: { message: { author: { role: 'assistant' }, content: { parts: ['a'] }, create_time: 1700000010 } },
			},
		},
	];
	const reports = convertFiles([{ name: 'conversations.json', buffer: utf8Buf(JSON.stringify(doc)) }]);
	assert.equal(reports[0].format, 'chatgpt');
	const chat = reports[0].chats[0];
	assert.ok(Number.isFinite(chat.conversation.createdAt));
	assert.ok(Number.isFinite(chat.conversation.updatedAt));
	assert.match(chat.files.md, /^\d{4}-\d{2}-\d{2} Guard chat /);
	assert.ok(!chat.files.md.includes('NaN'));
});

// ---- UTF-16 exports ---------------------------------------------------------

test('UTF-16LE BOM (PowerShell Out-File) is decoded and detected as claude', () => {
	const detected = detectAndParse('conversations.json', utf16Buf(claudeJson, false));
	assert.equal(detected.format, 'claude');
	assert.equal(detected.chats.length, 1);
	assert.equal(detected.chats[0].title, 'U16 chat');
	assert.equal(detected.chats[0].messages[0].content, 'hello utf16');
});

test('UTF-16BE BOM is decoded and detected as claude', () => {
	const detected = detectAndParse('conversations.json', utf16Buf(claudeJson, true));
	assert.equal(detected.format, 'claude');
	assert.equal(detected.chats[0].messages[1].content, 'hi back');
});

test('UTF-8 without BOM behaves exactly as before', () => {
	const detected = detectAndParse('conversations.json', utf8Buf(claudeJson));
	assert.equal(detected.format, 'claude');
	assert.equal(detected.chats.length, 1);
});

// ---- zip decompression preflight -------------------------------------------

function patchedZip(mutate: (buf: Uint8Array, dv: DataView) => void): ArrayBuffer {
	const buf = new Uint8Array(zipSync({ 'conversations.json': strToU8(JSON.stringify(chatgptExportJson('zip chat'))) }));
	mutate(buf, new DataView(buf.buffer));
	return toArrayBuffer(buf);
}

function findSignature(buf: Uint8Array, s0: number, s1: number, s2: number, s3: number): number {
	for (let i = buf.length - 4; i >= 0; i--) {
		if (buf[i] === s0 && buf[i + 1] === s1 && buf[i + 2] === s2 && buf[i + 3] === s3) return i;
	}
	return -1;
}

test('zip preflight: a normal tiny zip still converts', () => {
	const zipped = zipSync({ 'conversations.json': strToU8(JSON.stringify(chatgptExportJson('zip chat'))) });
	const detected = detectAndParse('ok.zip', toArrayBuffer(zipped));
	assert.equal(detected.format, 'chatgpt');
	assert.equal(detected.chats[0].title, 'zip chat');
});

test('zip preflight: central directory claiming > 1GB uncompressed is refused', () => {
	const buf = patchedZip((b, dv) => {
		const cd = findSignature(b, 0x50, 0x4b, 0x01, 0x02);
		assert.ok(cd >= 0, 'central directory header found');
		dv.setUint32(cd + 24, 0x50000000, true); // 1.25 GB claimed
	});
	assert.equal(detectAndParse('bomb.zip', buf).format, 'unknown');
});

test('zip preflight: entry count over the limit is refused', () => {
	const buf = patchedZip((b, dv) => {
		const eocd = findSignature(b, 0x50, 0x4b, 0x05, 0x06);
		assert.ok(eocd >= 0, 'EOCD found');
		dv.setUint16(eocd + 10, 20000, true);
	});
	assert.equal(detectAndParse('many.zip', buf).format, 'unknown');
});

test('zip preflight: absent central directory is refused', () => {
	const buf = patchedZip((b, dv) => {
		const eocd = findSignature(b, 0x50, 0x4b, 0x05, 0x06);
		assert.ok(eocd >= 0, 'EOCD found');
		dv.setUint32(eocd, 0, true); // destroy the EOCD signature
	});
	assert.equal(detectAndParse('broken.zip', buf).format, 'unknown');
});

// ---- web sourceLabel XSS ----------------------------------------------------

// Minimal DOM stand-in: app.ts wires listeners and renders once at import time.
function stubDom(): void {
	const el = (): Record<string, unknown> => {
		const children: unknown[] = [];
		return {
			addEventListener: () => {},
			classList: { add: () => {}, remove: () => {} },
			value: '',
			textContent: '',
			className: '',
			type: '',
			checked: false,
			href: '',
			download: '',
			dataset: {},
			children,
			append: (...nodes: unknown[]) => void children.push(...nodes),
			replaceChildren: () => void children.splice(0, children.length),
			setAttribute: () => {},
			add: () => {},
			click: () => {},
		};
	};
	const g = globalThis as unknown as Record<string, unknown>;
	g.document = {
		getElementById: () => el(),
		querySelector: () => null,
		createElement: () => el(),
	};
	g.Option = class {
		text: unknown;
		value: unknown;
		constructor(text?: string, value?: string) {
			this.text = text;
			this.value = value;
		}
	};
}

test('web: sourceLabel carries hostile provider/model as inert text', async () => {
	stubDom();
	const { sourceLabel } = await import('../src/web/app');
	const chat: ConvertedChat = {
		conversation: {
			id: 'conv_1700000000000_abc123def',
			title: 'T',
			messages: [],
			createdAt: 0,
			updatedAt: 0,
			provider: '<img src=x onerror=alert(1)>',
			model: '"><script>alert(2)</script>',
		},
		curt: '',
		markdown: '',
		files: { curt: 'T.curt', md: 'T.md' },
	};
	const label = sourceLabel(chat);
	// app.ts renders the suffix via textContent, so hostile strings are safe
	// verbatim — they become text nodes, never markup.
	assert.ok(label.includes('<img src=x onerror=alert(1)>'), `provider carried verbatim: ${label}`);
	assert.ok(label.includes('<script>alert(2)</script>'), `model carried verbatim: ${label}`);
	assert.ok(!sourceLabel({ ...chat, conversation: { ...chat.conversation, provider: '' } }));
});

test('web: app builds DOM with textContent — no HTML-string sinks', async () => {
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(new URL('../src/web/app.ts', import.meta.url), 'utf8');
	assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(source), 'app.ts must not assign HTML strings');
});
