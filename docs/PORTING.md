# Porting guide

How each source format works, what survives, and what doesn't.

## Provider matrix

| Provider | Bulk import | How |
|---|---|---|
| ChatGPT | ✓ | Settings → Data controls → Export (zip or conversations.json) |
| Claude | ✓ | Settings → Privacy → Export data (zip or conversations.json) |
| Grok | ✓ | grok.com → Settings → Data export (JSON archive) |
| Gemini | ✓* | Google Takeout → My Activity (JSON). *When the export carries responses; prompts-only exports are rejected — use paste |
| Curtis | ✓ | .curt files, Curtis markdown, or a bulk-export zip |
| DeepSeek, Kimi, 豆包, 文心一言, MiniMax, Z.ai | paste | No official export — copy the chat (or use a browser-extension export) and paste/select a .md file. Chinese labels (我/用户/AI/助手) and full-width colons parse natively |
| Open WebUI, LM Studio, anything else | likely ✓ | Generic JSON: role/content arrays, messages/history/data wrappers, containers of conversations. If it's a transcript, it imports |
| Copilot, Meta AI | paste | No export; copy-paste works |

You never pick a format — drop the file and detection routes it.

## Getting your data out

### ChatGPT

chat.openai.com → Settings → Data controls → Export data. You get a zip by email in ~a day. The porter reads the zip directly (or unzip it first and hand over `conversations.json`).

Notes on the format: each conversation is a `mapping` tree of nodes (parents/children), not a flat list. Regenerations and edited messages create branches; the porter flattens chronologically by node create time, which reproduces the conversation as the user experienced it (first-written branch first). OpenAI's platform system prompts and tool-execution nodes are dropped — they aren't part of the visible conversation, and orphan tool output would make providers reject the history on continuation. The `model_slug` of each answer is kept as per-message metadata.

### Claude

claude.ai → Settings → Privacy → Export data. The zip contains `conversations.json`: flat, ordered `chat_messages` with `sender: human | assistant`, ISO timestamps, and text either in a top-level `text` field or `{type: 'text', text}` content blocks. Both shapes are handled; only human/assistant turns are kept.

### Grok

grok.com → Settings → Data export. The archive is JSON: a `conversations` array, each chat carrying a nested `responses` array of turns. Field names have drifted across versions, so the parser accepts `message`/`text`/`content` for turn bodies and epoch seconds, milliseconds, or ISO strings for timestamps.

### Gemini

takeout.google.com → select "My Activity" → JSON format. The export is a flat activity list (no conversation grouping): prompts arrive as items titled "Prompted …", and Gemini's answers ride in the item body when your export includes them. The porter sorts turns by time and splits them into conversations at gaps longer than three hours. Coverage varies by account and export era — **prompts-only exports import nothing by design** (a conversation needs both sides); use the paste path for those.

### DeepSeek / Kimi / 豆包 / 文心一言 / MiniMax / Z.ai

No official bulk export exists for any of the Chinese apps (this is why a whole ecosystem of browser-export extensions exists). Two paths, both supported:

1. **Paste** — select the chat, copy, paste into the porter. Chinese speaker labels (我 / 用户 / AI / 助手 / 机器人), full-width colons (：), and `## 用户`-style headings all parse.
2. **Browser-extension markdown** — the export extensions produce markdown with bold or heading speaker labels; save as `.md` and drop it in.

Detection is conservative everywhere: if a paste or extension export doesn't yield at least one message per side, nothing is imported — you'll see "no conversations recognized" rather than a mangled chat.

### Generic JSON

Any `[{role, content}, ...]` or `{messages: [...]}` transcript works, including `from: human | user | bot | gpt` key styles and content-block arrays. One unattributable entry rejects the whole document (by design).

### Curtis formats (round-trip)

`.curt` files and Curtis markdown transcripts pass through at full fidelity — ids, timestamps, token stats, images, and tool-call metadata are preserved verbatim, and re-emitting markdown yields byte-identical files. Use this for vault-to-vault moves and backups. The formats themselves are normative in [curt-format.md](curt-format.md); this guide is about what the porter does with them. A whole-history **bulk export** from Curtis ("Export all chats as .curt (zip)") is a zip of `.curt` files — the porter reads it like any other zip and converts every conversation inside.

## Taking Curtis chats out

v0.2.0 adds the export direction: `.curt` files and Curtis markdown go back out to other platforms. Feed the exporter anything the importer reads — `.curt` files, Curtis markdown, a bulk-export zip.

```
curt-porter export <file...> [--to chatgpt-json|api-jsonl|continuation] [--target chatgpt|claude|gemini|generic] [--out <dir>] [--zip] [--budget <tokens>]
```

Defaults: `--to continuation`, `--out ./curt-porter-out`. The web page offers the same three targets as downloads after a conversion run.

- **`continuation`** (default) — a markdown **continuation pack**, meant to be attached to a ChatGPT, Claude or Gemini chat. A preamble tells the model to adopt the transcript's context and continue from the last message; the turns follow as clean `## You` / `## Assistant` sections. This is the answer to the missing bulk-import APIs: no platform lets you push history in, but you can hand the transcript to a chat you're already in and pick up where you left off. `--target` tailors the preamble to the destination app (`chatgpt`, `claude`, `gemini`, or the neutral `generic`); each pack opens with a provenance line — turns, date span, model — so the fresh chat knows what it's resuming; and the run reports how many turns survived the budget.
- **`chatgpt-json`** — a ChatGPT-export-shaped `conversations.json`. For tools that ingest ChatGPT exports (TypingMind and similar): Curtis history goes anywhere that format is read.
- **`api-jsonl`** — one `{"messages": [...]}` object per line, the API shape. For API replay, fine-tune prep, and JSON importers that want the plain shape.

`--budget <tokens>` (default 30000, estimated as chars/4) applies to continuation packs. A transcript over budget keeps the first user message plus the most recent turns; the dropped middle is marked with an explicit omission marker rather than silently truncated.

## Verify and stats

Two read-only commands round out the CLI.

### verify

```
curt-porter verify <file...> [--json]
```

The round-trip guarantee, as a command: every file must parse as a native Curtis format (`.curt` or Curtis markdown) **and** re-serialize byte-for-byte identical. Verdicts:

- **OK, round-trips byte-for-byte** — canonical: this file is exactly what the porter (or Curtis) would emit.
- **valid, not byte-canonical** — parses and re-imports fine, but the bytes differ from canonical form (hand edits, foreign whitespace, an older writer). Re-save via `convert` to canonicalize; this is a warning, not a failure.
- **INVALID** — fails validation. Exit code 1.

Anything that isn't a native format also fails the run, so `curt-porter verify ./curt/*.curt && do-next-thing` is a safe gate in scripts. `--json` emits one `{format, ok, canonical, issues, summary}` object per file.

### stats

```
curt-porter stats <file...> [--json]
```

Aggregates what a history contains: conversations, messages, words, token and cost totals (counting only the messages that carry them), providers, models, activity by month, largest conversations. Input is anything the importer reads — a ChatGPT export zip works as well as a folder of `.curt` files. Hostile numeric garbage (NaN, Infinity) is ignored. `--json` emits the full breakdown; the text report is for humans.

Both commands are CLI-only today; the web page doesn't duplicate them.

### What does not survive export

Only message text travels. Tool calls, images, and memory-fact chip ids stay behind — foreign platforms have no place to put them, and a continuation pack is prose by design.

## What does not survive a foreign import

- Images: foreign exports reference images server-side (or in separate files); the porter imports text only. Curtis-attached images (base64 in the export) round-trip fine.
- Tool-call output from foreign transcripts: dropped, for continuation-safety (see ChatGPT notes).
- Branch trees: flattened to one linear timeline (first-written branch).
- Account metadata: only conversation content and timestamps come over.

## Filename conventions

- `.curt`: `<title>.curt` (same rule as Curtis's export; a same-titled pair in one run gets an id suffix).
- Vault markdown: `<created-date> <slug> <id6>.md` — Curtis's own `fileNameFor` convention, so files sort chronologically in Obsidian's explorer and never collide.

## Idempotence

Every conversation gets a dedupe key: `title + message count + first user message (200 chars)`. Within one run — and against any list you convert together — duplicates are skipped. Re-porting last month's export after this month's export is safe.

## Continuing an imported chat

Imported conversations keep their original provider/model as display metadata only. When you continue one in Curtis, it sends the full history to whatever provider you have active — which is the point.
