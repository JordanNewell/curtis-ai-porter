// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Shared shapes for foreign-format conversion.
//
// These types mirror Curtis AI Chat's plugin types (Conversation,
// ConversationMessage, TokenUsage in src/types.ts; ParsedChat / ParsedMessage
// in src/import/types.ts) field-for-field — the porter must emit objects the
// plugin's importers accept verbatim. When Curtis changes a shape, change it
// here too and let test/curtis-contract.test.ts catch drift.

// ---------------------------------------------------------------------------
// Conversation model (subset of Curtis src/types.ts that the porter touches;
// extra fields survive .curt round-trips because serialization is JSON.stringify)
// ---------------------------------------------------------------------------

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cachedTokens?: number;
}

export interface ToolCall {
	id: string;
	type?: string;
	function?: { name?: string; arguments?: string };
	[index: string]: unknown;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ConversationMessage {
	id: string;
	role: MessageRole;
	content: string;
	timestamp: number;
	cost?: number;
	tokens?: TokenUsage;
	provider?: string;
	model?: string;
	/** Named agent that produced this message (assistant) or that the turn
	 *  ran under (user) — per-message attribution for mid-conversation
	 *  agent switching. Ids only; the agent may later be deleted or edited.
	 *  Mirrors Curtis 2.0.1 src/types.ts. */
	agentId?: string;
	images?: string[];
	attachedNotes?: string[];
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	tool_error?: boolean;
	/** Ids of memory facts injected into the system prompt for this turn (assistant messages only). Stored as ids — not contents — so chips stay truthful after facts are edited. Mirrors Curtis 2.0 src/types.ts. */
	memoriesUsedIds?: string[];
}

export interface Conversation {
	id: string;
	title: string;
	messages: ConversationMessage[];
	createdAt: number;
	updatedAt: number;
	provider: string;
	model: string;
	/** Swarm role. 'leader' chats may spawn follower agents; 'follower' chats
	 *  are driven by a leader. Undefined for ordinary chats. Mirrors Curtis
	 *  2.0 src/types.ts. */
	role?: 'leader' | 'follower';
	/** For followers: the conversation id of the leader that spawned them. */
	leaderId?: string;
	/** Named agent bound to this chat — resolves persona, model routing, and
	 *  tool ACL at request time. Undefined = the default assistant. Mirrors
	 *  Curtis 2.0.1 src/types.ts. */
	agentId?: string;
	/** Skills attached to this conversation via /skill — ids (skill names).
	 *  Undefined = none. Mirrors Curtis 2.0.1 src/types.ts. */
	skillIds?: string[];
}

// ---------------------------------------------------------------------------
// Import pipeline shapes (mirror of Curtis src/import/types.ts)
// ---------------------------------------------------------------------------

export type ImportFormat = 'curt' | 'curtis-md' | 'chatgpt' | 'claude' | 'grok' | 'gemini' | 'generic-json' | 'generic-md';

/** One message pulled out of a foreign export. */
export interface ParsedMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	/** Epoch ms when known (ChatGPT exports seconds; Claude ISO strings). */
	timestamp?: number;
	/** Model id recorded on assistant messages, when the export carries it. */
	model?: string;
}

/** A conversation extracted from a foreign export, before id assignment. */
export interface ParsedChat {
	title: string;
	messages: ParsedMessage[];
	createdAt?: number;
	updatedAt?: number;
	/** Original provider/model recorded as display metadata only. */
	provider?: string;
	model?: string;
}

/** Result of detection: the format plus, lazily, the parsed chats. */
export interface DetectedFile {
	format: ImportFormat | 'unknown';
	chats: ParsedChat[];
	/** Only set when format is 'curt' or 'curtis-md' — these round-trip a full
	 *  Conversation (ids, tokens, images) so they skip normalization. */
	conversations?: Conversation[];
}

// ---------------------------------------------------------------------------
// Porter conversion results (what the CLI / web UI consume)
// ---------------------------------------------------------------------------

/** One converted conversation, ready to be written out. */
export interface ConvertedChat {
	conversation: Conversation;
	/** .curt body (JSON with magic field) — the portable envelope. */
	curt: string;
	/** Curtis markdown transcript — drop into the vault's AI/Conversations. */
	markdown: string;
	/** Basenames for output files. */
	files: { curt: string; md: string };
}

/** Per-input-file outcome of a conversion run. */
export interface ConversionReport {
	file: string;
	format: ImportFormat | 'unknown';
	/** Conversations converted; duplicates already seen this run are excluded. */
	chats: ConvertedChat[];
	skipped: number;
	error?: string;
}
