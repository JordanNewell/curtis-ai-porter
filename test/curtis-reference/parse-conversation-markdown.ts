// VENDORED REFERENCE — do not edit by hand.
//
// Verbatim copy of parseConversationMarkdown (the Curtis vault-transcript
// parser) from curtis-ai-chat src/chat/conversation-format.ts, with its
// supporting constants, the YamlPort interface, and helpers. This snapshot is
// the porter's standalone contract oracle for the markdown+marker layout:
// `npm test` validates porter output against it without requiring the plugin
// repo. When the plugin's parser changes, re-copy it here and note the plugin
// version below.
//
// Source: curtis-ai-chat src/chat/conversation-format.ts @ v2.0.1 (1c7a19f, 2026-10-11)
// Differences from the original: the serialize half of the module
// (serializeConversationMarkdown, conversationFileName, and the shared
// slugify helper) is dropped — only the parse contract survives here — and
// the Conversation shapes come from the porter's core mirror of the plugin's
// types. The YamlPort indirection is kept verbatim; tests pass a port backed
// by the 'yaml' package (the flat frontmatter this format uses parses the
// same under Obsidian's js-yaml and the 'yaml' package).
// v2.0.1 adds optional agent/skill provenance: `agentId` on the conversation
// and per-message, `skillIds` on the conversation — all read the same
// way as the fields around them; files without them parse identically.

import type { Conversation, ConversationMessage, TokenUsage } from '../../src/core/types';

/** YAML codec for conversation frontmatter. */
export interface YamlPort {
	parse(text: string): unknown;
	dump(value: unknown): string;
}

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

/**
 * Parse a conversation markdown file into a Conversation.
 *
 * Layout (written by serializeConversationMarkdown; hand edits tolerated):
 *
 *   ---
 *   curtis: conversation
 *   id: conv_...
 *   ...
 *   ---
 *
 *   # Title
 *
 *   ## You
 *   <!-- curtis:msg {"id":"...","ts":...,"role":"user"} -->
 *
 *   message content
 *
 * The marker ends the heading area and opens the message; a message's content
 * runs from the end of its marker to the role heading that precedes the next
 * marker (or EOF). Sections without a marker can't be attributed to a role,
 * so they are not ingested — they stay readable in the file.
 *
 * Returns null when the file isn't a Curtis conversation (no frontmatter
 * signature) or the frontmatter is unreadable.
 */
export function parseConversationMarkdown(raw: string, fallbackMtime: number, yaml: YamlPort): Conversation | null {
	const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\s*\n?/);
	if (!fmMatch) return null;
	let fm: Record<string, unknown>;
	try {
		fm = yaml.parse(fmMatch[1]) as Record<string, unknown>;
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
	// heading begins. Scan back from the next marker over whitespace; if the
	// line above it is one of our fixed role headings, that heading starts the
	// next block — otherwise the next marker itself is the boundary.
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
