// Id generation — shapes are normative in docs/curt-format.md:
//   conversation: conv_<ms>_<9 base36 chars>   message: msg_<ms>_<6 base36 chars>
// This module pads the random segment to full width (a bare Math.random slice
// can run short), and assignIds keeps the first duplicate id — behaviors the
// plugin's current source shares; the pinned plugin release predates both,
// and readers never validate id shape.

function rand(chars: number): string {
	return Math.random().toString(36).slice(2, 2 + chars).padEnd(chars, '0');
}

export function newConversationId(): string {
	return `conv_${Date.now()}_${rand(9)}`;
}

export function newMessageId(): string {
	return `msg_${Date.now()}_${rand(6)}`;
}

/**
 * Fill in missing conversation/message ids in place (mirrors the plugin's
 * importConversation): a conversation without an id gets one; messages
 * without an id — or duplicating an id already used in the same conversation
 * — get fresh ones. .curt / Curtis-markdown round-trips never pass through
 * here; foreign imports always do.
 */
export function assignIds(conv: { id: string; messages: { id: string }[] }): void {
	if (!conv.id) conv.id = newConversationId();
	const seen = new Set<string>();
	for (const msg of conv.messages) {
		if (!msg.id || seen.has(msg.id)) msg.id = newMessageId();
		seen.add(msg.id);
	}
}
