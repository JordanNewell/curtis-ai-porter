// Curtis markdown transcripts — the vault format.
//
// Mirrors the serializer/parser in curtis-ai-chat src/chat/conversation-format.ts
// (serializeConversationMarkdown / parseConversationMarkdown; the plugin's
// Obsidian YamlPort is swapped for the yaml package here).
//
// Layout, one file per conversation:
//
//   ---
//   curtis: conversation
//   id: conv_...
//   ...
//   ---
//
//   # Title
//
//   ## You
//   <!-- curtis:msg {"id":"...","ts":...,"role":"user"} -->
//
//   message content
//
// The hidden HTML comment carries machine metadata; everything else is
// human-readable markdown that Obsidian search indexes natively. Dropping a
// file with this shape (and the `curtis: conversation` frontmatter) into the
// vault's conversations folder makes it appear in Curtis chat history.

import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import type { Conversation, ConversationMessage, TokenUsage } from './types';
import { sanitizeFilename } from './curt';

/** Marker opening every message block. Content between markers is the message. */
const MSG_MARKER_RE = /<!--\s*curtis:msg\s+(\{[\s\S]*?\})\s*-->/g;
/** Human-facing section labels, fixed set — the parser strips exactly one of
 *  these above each marker; anything else is treated as message content. */
const ROLE_LABELS: Record<ConversationMessage['role'], string> = {
	user: 'You',
	assistant: 'AI',
	tool: 'Tool',
	system: 'System',
};
const HEADING_LINE_RE = /^## (You|AI|Tool|System)\s*$/;

/** Serialize a conversation as a Curtis markdown transcript. */
export function serializeCurtisMarkdown(conv: Conversation): string {
	const fm: Record<string, unknown> = {
		curtis: 'conversation',
		id: conv.id,
		created: conv.createdAt,
		updated: conv.updatedAt,
		provider: conv.provider,
		model: conv.model,
	};
	if (conv.role) fm.role = conv.role;
	if (conv.leaderId) fm.leaderId = conv.leaderId;
	if (conv.agentId) fm.agentId = conv.agentId;
	if (conv.skillIds && conv.skillIds.length > 0) fm.skillIds = conv.skillIds;

	const parts: string[] = [`---\n${yamlStringify(fm).replace(/\n+$/, '\n')}---`, '', `# ${conv.title}`, ''];
	for (const msg of conv.messages) {
		const meta: Record<string, unknown> = { id: msg.id, ts: msg.timestamp, role: msg.role };
		if (msg.provider) meta.provider = msg.provider;
		if (msg.model) meta.model = msg.model;
		if (msg.agentId) meta.agentId = msg.agentId;
		if (msg.cost) meta.cost = msg.cost;
		if (msg.tokens) meta.tokens = msg.tokens;
		if (msg.images && msg.images.length > 0) meta.images = msg.images;
		if (msg.attachedNotes && msg.attachedNotes.length > 0) meta.attachedNotes = msg.attachedNotes;
		if (msg.tool_calls && msg.tool_calls.length > 0) meta.tool_calls = msg.tool_calls;
		if (msg.tool_call_id) meta.tool_call_id = msg.tool_call_id;
		if (msg.tool_error) meta.tool_error = true;
		if (msg.memoriesUsedIds && msg.memoriesUsedIds.length > 0) meta.mem = msg.memoriesUsedIds;
		// Escape the comment terminator so metadata containing "-->" can't
		// break out of the marker.
		const json = JSON.stringify(meta).replace(/-->/g, '--\\u003E');
		// A message body quoting the marker itself would split this message in
		// two on the next parse — neutralize the opener. The zero-width space
		// is invisible and survives round-trips.
		const content = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''))
			.replace(/<!--\s*curtis:msg/g, '<!--\u200Bcurtis:msg');
		parts.push(
			`## ${ROLE_LABELS[msg.role] ?? 'AI'}`,
			`<!-- curtis:msg ${json} -->`,
			'',
			content.trim(),
			''
		);
	}
	return parts.join('\n');
}

/**
 * Parse a Curtis markdown transcript into a Conversation. Returns null when
 * the file isn't one (no frontmatter signature) or the frontmatter is
 * unreadable. Sections without a marker can't be attributed to a role, so
 * they are not ingested — they stay readable in the file.
 */
export function parseConversationMarkdown(raw: string, fallbackMtime: number): Conversation | null {
	const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\s*\n?/);
	if (!fmMatch) return null;
	let fm: Record<string, unknown>;
	try {
		fm = yamlParse(fmMatch[1]) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (!fm || fm.curtis !== 'conversation' || typeof fm.id !== 'string') return null;

	const bodyStart = fmMatch[0].length;
	const body = raw.slice(bodyStart);

	// Locate every message marker.
	MSG_MARKER_RE.lastIndex = 0;
	const markers: Array<{ meta: Record<string, unknown>; start: number; end: number }> = [];
	let m: RegExpExecArray | null;
	while ((m = MSG_MARKER_RE.exec(body)) !== null) {
		try {
			markers.push({ meta: JSON.parse(m[1]) as Record<string, unknown>, start: m.index, end: m.index + m[0].length });
		} catch {
			// Malformed marker — treat as content, not a boundary.
		}
	}

	// Title = first H1 in the region before the first marker.
	const pre = body.slice(0, markers[0]?.start ?? body.length);
	const titleMatch = pre.match(/^# (.+)$/m);
	const title = titleMatch?.[1]?.trim() || 'Untitled';

	// For each marker, the content region ends where the NEXT message's role
	// heading begins (see the plugin's parser for the full boundary walk).
	const messages: ConversationMessage[] = [];
	for (let i = 0; i < markers.length; i++) {
		const { meta } = markers[i];
		const role = readRole(meta.role);
		if (!role) continue;
		let contentEnd = body.length;
		if (i + 1 < markers.length) {
			const next = markers[i + 1].start;
			let j = next;
			while (j > 0 && /[\s]/.test(body[j - 1])) j--;
			const lineStart = body.lastIndexOf('\n', j - 1) + 1;
			const line = body.slice(lineStart, next).trimEnd();
			contentEnd = HEADING_LINE_RE.test(line) ? lineStart : next;
		}
		const content = body.slice(markers[i].end, contentEnd).replace(/^\n+/, '').replace(/\s+$/, '');
		messages.push({
			id: typeof meta.id === 'string' ? meta.id : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			role,
			content,
			timestamp: typeof meta.ts === 'number' ? meta.ts : fallbackMtime,
			provider: typeof meta.provider === 'string' ? meta.provider : undefined,
			model: typeof meta.model === 'string' ? meta.model : undefined,
			agentId: typeof meta.agentId === 'string' ? meta.agentId : undefined,
			cost: typeof meta.cost === 'number' ? meta.cost : undefined,
			tokens: isTokenUsage(meta.tokens) ? meta.tokens : undefined,
			images: readStringArray(meta.images),
			attachedNotes: readStringArray(meta.attachedNotes),
			tool_calls: Array.isArray(meta.tool_calls) ? (meta.tool_calls as ConversationMessage['tool_calls']) : undefined,
			tool_call_id: typeof meta.tool_call_id === 'string' ? meta.tool_call_id : undefined,
			tool_error: meta.tool_error === true || undefined,
			memoriesUsedIds: readStringArray(meta.mem),
		});
	}

	const updatedAt = typeof fm.updated === 'number' ? fm.updated : fallbackMtime;
	const created = typeof fm.created === 'number' ? fm.created : updatedAt;
	return {
		id: fm.id,
		title,
		messages,
		createdAt: created,
		updatedAt,
		provider: typeof fm.provider === 'string' ? fm.provider : '',
		model: typeof fm.model === 'string' ? fm.model : '',
		role: fm.role === 'leader' || fm.role === 'follower' ? fm.role : undefined,
		leaderId: typeof fm.leaderId === 'string' ? fm.leaderId : undefined,
		agentId: typeof fm.agentId === 'string' ? fm.agentId : undefined,
		skillIds: readStringArray(fm.skillIds),
	};
}

/**
 * Vault filename for a conversation — identical convention to the plugin's
 * fileNameFor: "<created-date> <slug> <id6>.md" so files sort chronologically
 * in the explorer and survive title renames without colliding.
 */
export function vaultFileNameFor(conv: Conversation): string {
	// Hostile frontmatter/exports can carry NaN/Infinity — that would render
	// "NaN-NaN-NaN" into the name. Fall back to now.
	const ms = Number.isFinite(conv.createdAt) ? conv.createdAt : Date.now();
	const d = new Date(ms);
	const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	// The id fragment lands in a filename; round-trips never reassign ids, so a
	// crafted id like "a_b/c" must be sanitized, not trusted.
	const short = sanitizeFilename(conv.id.split('_').pop()?.slice(-6) || conv.id.slice(-6));
	return `${date} ${slugify(conv.title)} ${short}.md`;
}

/** Turn a conversation title into a filesystem-safe filename fragment. */
function slugify(title: string): string {
	const cleaned = (title || '')
		.replace(/[\\/:*?"<>|#^[\]]/g, '')
		// eslint-disable-next-line no-control-regex -- strip ASCII control chars that are illegal in filenames
		.replace(/[\x00-\x1f]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^\.+/, '')
		.trim()
		.replace(/[. ]+$/, '');
	const trimmed = cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
	return trimmed || 'Untitled';
}

function readRole(v: unknown): ConversationMessage['role'] | undefined {
	return v === 'user' || v === 'assistant' || v === 'tool' || v === 'system' ? v : undefined;
}

function readStringArray(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const arr = v.filter((x): x is string => typeof x === 'string');
	return arr.length > 0 ? arr : undefined;
}

function isTokenUsage(v: unknown): v is TokenUsage {
	if (!v || typeof v !== 'object') return false;
	const o = v as Record<string, unknown>;
	return typeof o.promptTokens === 'number' && typeof o.completionTokens === 'number' && typeof o.totalTokens === 'number';
}
