// Generic best-effort importers: plain JSON transcripts and role-headed
// markdown. Mirrors curtis-ai-chat src/import/generic.ts (kept in sync —
// see the porter's contract tests), extended here first:
//   - tolerant JSON normalization (role/from/sender/author, content blocks,
//     data/history/items wrappers, containers of conversations)
//   - Chinese speaker labels (我/用户/助手…) and full-width colons, so
//     transcripts pasted or scraped out of z.ai, Kimi, Doubao, Ernie and
//     MiniMax parse like any others.
//   - bare inline speaker labels (`You: …` / `我：…` at line start) — the
//     paste shape the README and web UI have always advertised; headings
//     and bold spans worked, bare prefixes didn't. Synced back to the
//     plugin's src/import/generic.ts.
//
// Best-effort means detection is conservative: if we can't confidently find
// both sides of a conversation, we say so instead of importing garbage.

import type { ParsedChat, ParsedMessage } from './types';

// ---- Generic JSON: [{role, content}, ...] or {messages: [...]} ----

const KNOWN_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

/** Object keys a transcript array commonly hides under. */
const TRANSCRIPT_KEYS = ['messages', 'history', 'data', 'items', 'conversation', 'responses', 'content'];
/** Object keys a container of conversations hides under. */
const CONTAINER_KEYS = ['conversations', 'chats', 'data', 'items'];

function contentToText(c: unknown): string {
	if (typeof c === 'string') return c.trim();
	if (Array.isArray(c)) {
		return c
			.map((p) => {
				if (typeof p === 'string') return p;
				if (p && typeof p === 'object') {
					const b = p as Record<string, unknown>;
					if (typeof b.text === 'string' && b.text.trim()) return b.text;
					if (typeof b.content === 'string' && b.content.trim()) return b.content;
				}
				return '';
			})
			.filter(Boolean)
			.join('\n')
			.trim();
	}
	return '';
}

/** Pull the role out of a message-ish object across naming conventions. */
function toRole(m: Record<string, unknown>): ParsedMessage['role'] | null {
	const role = m.role ?? m.from ?? m.sender ?? m.speaker;
	if (typeof role === 'string') {
		const l = role.trim().toLowerCase();
		if (KNOWN_ROLES.has(l)) return l as ParsedMessage['role'];
		if (l === 'human' || l === 'user' || l === '我' || l === '用户') return 'user';
		if (l === 'assistant' || l === 'bot' || l === 'gpt' || l === 'ai' || l === 'model' || l === '助手' || l === '机器人') return 'assistant';
	}
	const author = m.author;
	if (author && typeof author === 'object') {
		const ar = (author as Record<string, unknown>).role;
		if (typeof ar === 'string' && KNOWN_ROLES.has(ar)) return ar as ParsedMessage['role'];
	}
	if (m.is_user === true || m.isUser === true) return 'user';
	if (m.is_bot === true || m.isBot === true || m.is_assistant === true) return 'assistant';
	return null;
}

/** Pull the text out of a message-ish object across naming conventions. */
function toText(m: Record<string, unknown>): string {
	for (const key of ['content', 'text', 'message', 'value', 'output']) {
		const t = contentToText(m[key]);
		if (t) return t;
	}
	return '';
}

/** Returns null when the array isn't a role/content transcript. */
function transcriptFromArray(arr: unknown[]): ParsedMessage[] | null {
	const messages: ParsedMessage[] = [];
	for (const raw of arr) {
		if (!raw || typeof raw !== 'object') continue;
		const m = raw as Record<string, unknown>;
		const role = toRole(m);
		if (!role) return null; // one unattributable entry → not a transcript
		const text = toText(m);
		if (!text) continue;
		messages.push({ role, content: text });
	}
	return messages.length > 0 ? messages : null;
}

/** Returns null when the JSON doesn't look like a role/content transcript. */
export function parseGenericJson(data: unknown): ParsedChat | null {
	const chats = parseGenericJsonAll(data);
	return chats.length === 1 ? chats[0] : null;
}

/**
 * All transcripts found in a JSON document: bare arrays, messages-shaped
 * objects, wrappers (data/history/items), and containers of conversations
 * ({conversations: [{title, messages: [...]}, …]} as Open WebUI and friends
 * export them).
 */
export function parseGenericJsonAll(data: unknown): ParsedChat[] {
	if (Array.isArray(data)) {
		const messages = transcriptFromArray(data);
		return messages ? [{ title: 'Imported chat', messages }] : [];
	}
	if (!data || typeof data !== 'object') return [];
	const obj = data as Record<string, unknown>;

	// Container of conversations: items that each carry their own transcript.
	for (const key of CONTAINER_KEYS) {
		const arr = obj[key];
		if (!Array.isArray(arr) || arr.length === 0) continue;
		const chats: ParsedChat[] = [];
		for (const item of arr) {
			if (!item || typeof item !== 'object') continue;
			const im = item as Record<string, unknown>;
			for (const sub of TRANSCRIPT_KEYS) {
				if (!Array.isArray(im[sub])) continue;
				const messages = transcriptFromArray(im[sub] as unknown[]);
				if (!messages) continue;
				const title = typeof im.title === 'string' && im.title.trim() ? im.title.trim() : typeof im.name === 'string' && im.name.trim() ? im.name.trim() : 'Imported chat';
				chats.push({ title, messages });
				break;
			}
		}
		if (chats.length > 0) return chats;
	}

	// Plain transcript under a wrapper key or inline.
	for (const key of TRANSCRIPT_KEYS) {
		const arr = obj[key];
		if (!Array.isArray(arr)) continue;
		const messages = transcriptFromArray(arr);
		if (messages) return [{ title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : 'Imported chat', messages }];
	}
	return [];
}

// ---- Generic markdown: role headings or bold speaker labels ----

/** Speaker labels that map to a role, matched case-insensitively at a
 *  markdown heading (`## You`), at the start of a bold span (`**User:**`),
 *  or as a bare prefix at line start (`User:` / `我：`). Chinese labels
 *  cover transcripts pasted or scraped out of z.ai, Kimi, Doubao, Ernie
 *  and MiniMax. */
const USER_LABELS = ['you', 'user', 'human', 'me', 'q', '我', '用户', '本人'];
const ASSISTANT_LABELS = ['ai', 'assistant', 'bot', 'chatgpt', 'claude', 'gemini', 'copilot', 'a', '助手', 'ai助手', '机器人'];

function labelToRole(label: string): ParsedMessage['role'] | null {
	const l = label.trim().toLowerCase().replace(/[:：\s]+$/u, '');
	if (USER_LABELS.includes(l)) return 'user';
	if (ASSISTANT_LABELS.includes(l)) return 'assistant';
	if (l === 'system' || l === '系统') return 'system';
	return null;
}

/**
 * Parse markdown where speakers are marked by headings (`#`–`####`), bold
 * prefixes (`**User:**` / `**我：**`), or bare inline prefixes (`User:` /
 * `我：` at line start). Returns null when fewer than one message per side
 * is found — ambiguous documents are not imported.
 */
export function parseGenericMarkdown(raw: string): ParsedChat | null {
	const lines = raw.split('\n');
	const messages: ParsedMessage[] = [];
	// Which label style the document uses, decided on the first confident hit.
	let style: 'heading' | 'bold' | 'inline' | null = null;
	let current: { role: ParsedMessage['role']; lines: string[] } | null = null;

	const flush = (): void => {
		if (!current) return;
		const text = current.lines.join('\n').trim();
		if (text) messages.push({ role: current.role, content: text });
		current = null;
	};

	for (const line of lines) {
		const heading = line.match(/^#{1,4}\s+(.+?)\s*$/);
		const bold = line.match(/^\*\*(.+?)[:：]?\*\*\s*(.*)$/u);
		// Bare prefix: a known label glued to a colon at line start. The colon
		// must sit directly after the label word, so prose like "Day 1: …" or
		// timestamps like "10:00 …" can't be mistaken for speakers.
		const inline = line.match(/^([^\s:：]{1,12})[:：][ \t]*(.*)$/u);
		if (style !== 'bold' && heading && labelToRole(heading[1])) {
			if (style === null) style = 'heading';
			if (style === 'heading') {
				flush();
				current = { role: labelToRole(heading[1]) as ParsedMessage['role'], lines: [] };
				continue;
			}
		}
		if (style !== 'heading' && bold && labelToRole(bold[1])) {
			if (style === null) style = 'bold';
			if (style === 'bold') {
				flush();
				current = { role: labelToRole(bold[1]) as ParsedMessage['role'], lines: [bold[2]] };
				continue;
			}
		}
		if ((style === null || style === 'inline') && inline && labelToRole(inline[1])) {
			if (style === null) style = 'inline';
			if (style === 'inline') {
				flush();
				current = { role: labelToRole(inline[1]) as ParsedMessage['role'], lines: [inline[2]] };
				continue;
			}
		}
		if (current) current.lines.push(line);
	}
	flush();

	const hasUser = messages.some((m) => m.role === 'user');
	const hasAssistant = messages.some((m) => m.role === 'assistant');
	if (!hasUser || !hasAssistant) return null;

	// Title: first H1, else first line of the first user message.
	const h1 = raw.match(/^# (.+)$/m)?.[1]?.trim();
	const firstUser = messages.find((m) => m.role === 'user');
	return {
		title: h1 || (firstUser ? firstUser.content.slice(0, 60) : 'Imported chat'),
		messages,
	};
}
