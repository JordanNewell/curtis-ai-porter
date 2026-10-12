# Curt conversation formats — specification

This document owns the `.curt` file format and the Curtis markdown transcript
format. Implementations conform to it; it does not describe any single codebase.
Curtis AI Chat (the Obsidian plugin) and curtis-ai-porter are both
conforming implementations — where code and spec disagree, one of them is wrong
and must be fixed. The conformance suites (see the end) arbitrate.

Pinned to curtis-ai-chat v2.0.1 (1c7a19f, 2026-10-11). Re-pin by re-copying the
vendored oracles in `test/curtis-reference/` and updating their headers.

## Design goals

1. **Byte-robust.** `.curt` is JSON: no marker-escaping edge cases, images and
   tool calls survive verbatim. Markdown trades some robustness for readability
   in Obsidian; its two escaping rules are normative (below).
2. **Human-readable where it matters.** The markdown layout is plain Obsidian
   markdown — searchable, diffable, hand-editable within the parse rules.
3. **Stable identity.** Ids are assigned once. A native round-trip never
   reassigns them.
4. **Strict readers.** A file is imported whole or rejected whole. No
   salvaging, no guessing, no partial imports.
5. **Local-first.** Nothing in either format requires network access.

## Conversation model

Both formats carry the same conversation shape. Epochs are Unix **milliseconds**
everywhere.

**Conversation**

| Field         | Type                          | Requirement                                            |
| ------------- | ----------------------------- | ------------------------------------------------------ |
| `id`          | string (conv id, see below)   | required; validated by both readers                    |
| `title`       | string                        | required in `.curt`; markdown title defaults `Untitled` |
| `messages`    | ConversationMessage[]         | required                                               |
| `createdAt`   | number                        | required in `.curt`; markdown falls back to file mtime  |
| `updatedAt`   | number                        | required in `.curt`; markdown falls back to file mtime  |
| `provider`    | string                        | written always; markdown read defaults `''`             |
| `model`       | string                        | written always; markdown read defaults `''`             |
| `role`        | `'leader' \| 'follower'`      | optional; anything else reads as absent                 |
| `leaderId`    | string (conv id)              | optional; set on followers                              |
| `agentId`     | string                        | optional; the in-vault agent that owns the conversation |
| `skillIds`    | string[]                      | optional; skills attached via /skill (ids, not bodies)  |

**ConversationMessage**

| Field            | Type      | Requirement                                              |
| ---------------- | --------- | -------------------------------------------------------- |
| `id`             | string    | required; validated in `.curt`, synthesized in markdown   |
| `role`           | enum      | required: `user` \| `assistant` \| `system` \| `tool`     |
| `content`        | string    | required                                                 |
| `timestamp`      | number    | required; epoch ms; markdown falls back to file mtime     |
| `cost`           | number    | optional                                                 |
| `tokens`         | object    | optional; `promptTokens`, `completionTokens`, `totalTokens` numbers (`cachedTokens` optional number) |
| `provider`       | string    | optional                                                 |
| `model`          | string    | optional                                                 |
| `images`         | string[]  | optional; typically base64 data URLs                     |
| `attachedNotes`  | string[]  | optional; vault note paths                               |
| `tool_calls`     | array     | optional; OpenAI-shaped (`id`, `type?`, `function?{name?, arguments?}`) |
| `tool_call_id`   | string    | optional; on `tool` messages                             |
| `tool_error`     | boolean   | optional; only ever `true` when present                  |
| `memoriesUsedIds`| string[]  | optional; memory-fact ids, not contents. Markdown key: `mem` |
| `agentId`        | string    | optional; the in-vault agent that produced the message   |

**Unknown fields.** `.curt` is the lossless envelope: extra fields on the
envelope, conversation, or message survive a round-trip untouched
(JSON serialization). Curtis markdown is a projection: the marker carries only
the known keys above, so unknown fields are silently dropped by a markdown
round-trip. The first-party `agentId` (conversation and message) and
`skillIds` (conversation) fields are carried by both formats since v2.0.1 —
writers emit them only when set, and files without them parse identically
under older readers. Writers that must preserve everything else write
`.curt`.

## Identifiers

```
conversation:  conv_<epoch-ms>_<9 base36 chars>
message:       msg_<epoch-ms>_<6 base36 chars>
```

Base36 is lowercase `[0-9a-z]`; writers pad the random segment to the full
width (9 or 6 characters). Readers never validate the shape — a shorter
segment from an older writer parses identically. Files written by the plugin's
native chat flow are indistinguishable from imported ones by construction.

- **Native round-trips** (`.curt` → parse → `.curt`, markdown → parse →
  markdown) **must never reassign ids.** Ever.
- **Foreign imports** assign fresh ids: the conversation always; a message when
  it lacks an id or duplicates an id already used in the same conversation.
  The first occurrence keeps its id; later duplicates are reassigned. (The
  plugin release pinned here still reassigns both twins; its current source
  keeps the first — readers accept either resolution.)
- **Native import colliding with a live conversation:** a `.curt` or markdown
  file whose id already exists in the live store imports under a fresh id; the
  file itself is never modified.
- The markdown reader synthesizes a fresh message id when a marker lacks one;
  the `.curt` reader rejects the file instead. Both behaviors are normative for
  their format.

## Format 1: `.curt`

One file, one conversation. UTF-8 JSON:

```json
{
	"curt": "curtis-conversation",
	"version": 1,
	"conversation": { "id": "conv_...", "...": "..." },
	"generator": "curtis-ai-porter@0.2.0"
}
```

- `curt` must be exactly `curtis-conversation` and `version` exactly `1`.
  Anything else is not a `.curt` file.
- Validation is strict: the conversation must carry every required field from
  the model above, and every message too. Any failure rejects the whole file —
  a hand-corrupted file is reported, not repaired or partially imported.
- `generator` is provenance, formatted `<app>@<version>` (the plugin stamps
  `curtis-ai-chat@<version>`, the porter `curtis-ai-porter@<version>`).
  Optional: first-party files from before the field existed and third-party
  writers omit it. **Readers must ignore it entirely** — its presence,
  absence, or value never affects parsing.
- The version is never hardcoded in the writer; an unversioned writer omits
  the field.

**Canonical serialization:** tab-indented JSON (`JSON.stringify(file, '\t')`)
with envelope key order `curt`, `version`, `conversation`, then `generator`
(only when present — it is assigned after the base object, so it serializes
last). Conversation and message field order follows the type declaration order
above.

**Filename:** `<sanitized title>.curt`. Sanitization: replace
`< > : " / \ | ? *` and ASCII/Unicode control characters with `_`; trim; cap at
100 characters; strip trailing dots and spaces (Windows silently drops them);
append `_` to reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`,
`LPT1-9`, case-insensitive); fall back to `conversation` when empty. The shared base rule — forbidden-character and
control-character replace, trim, fallback — is the import contract; the
100-char cap, trailing dot/space strip, and reserved-device-name suffix are
porter-side hardening on top of it.

## Format 2: Curtis markdown

One file, one conversation, plain Obsidian markdown:

```
---
curtis: conversation
id: conv_...
created: 1730000000000
updated: 1730000500000
provider: anthropic
model: claude-sonnet-4-5
---

# Title

## You
<!-- curtis:msg {"id":"msg_...","ts":1730000000000,"role":"user"} -->

message content

## AI
<!-- curtis:msg {"id":"msg_...","ts":1730000100000,"role":"assistant"} -->

reply
```

**Frontmatter.** Signature: `curtis: conversation` plus a string `id`. Without
it the file is not a Curtis conversation — the reader returns null and leaves
it alone (other vault files coexist). The file must begin with `---\n`.
Optional keys: `created`, `updated` (epoch ms; missing reads as the file's
mtime, `created` falls back to `updated`), `provider`, `model` (default `''`),
`role` (`leader`/`follower` only), `leaderId`, `agentId`, `skillIds`
(string[]; empty reads as absent). YAML is flat — no nested structures.

**Title.** The first `# ` H1 before the first marker; default `Untitled`.

**Message block.** A role heading, then a marker, then content:

- Heading: `## You` / `## AI` / `## Tool` / `## System` (fixed labels for
  `user`/`assistant`/`tool`/`system`). The heading is cosmetic — role comes
  from the marker, never the heading.
- Marker: `<!-- curtis:msg <json> -->`, whitespace-tolerant around the JSON.
  Marker JSON carries `id`, `ts`, `role` plus the optional keys from the model
  (`provider`, `model`, `agentId`, `cost`, `tokens`, `images`, `attachedNotes`,
  `tool_calls`, `tool_call_id`, `tool_error`, `mem`). A marker whose JSON
  doesn't parse is treated as ordinary content, not a boundary — and because
  the marker scan is lazy across newlines, the broken opener can reach forward
  and swallow the next valid marker too: both end up as content of the
  preceding message. That reach is part of the contract. A marker whose
  `role` is missing or invalid is skipped — it still bounds the previous
  message's content, but contributes no message of its own.
- Content: from the end of the marker to the role heading that precedes the
  next marker (or EOF). The writer emits fully trimmed content; the reader
  strips leading newlines and trailing whitespace — interior and leading
  spaces survive a round-trip.
- Sections without a marker are never ingested. They remain readable prose —
  hand-written notes survive but don't join the conversation.

**Escaping (normative for writers; readers depend on both):**

1. Every `-->` inside marker JSON is written as `--\u003E` so metadata can't
   terminate the comment early. JSON parsing restores it.
2. Every `<!-- curtis:msg` opener inside message content is written as
   `<!--\u200Bcurtis:msg` — the character U+200B (zero-width space) inserted
   directly after `<!--`, so a quoted marker can't split the message on
   re-parse. U+200B is not matched by the marker regex's whitespace rule, is
   invisible when rendered, and survives round-trips.

**Filename:** `<YYYY-MM-DD> <slug> <id6>.md` — the created date (local time),
the slugified title (strip `\ / : * ? " < > | # ^ [ ]` and ASCII control
characters, collapse whitespace, strip leading dots, trim, strip trailing
dots/spaces, cap at 60 characters, trim again, default `Untitled`), and the
last 6 characters of the conversation id's last `_`-segment,
filename-sanitized (a crafted id must never put a path separator in a vault
write path). Files sort chronologically; the id fragment keeps renames from
colliding.

## Canonical form

A native file is **canonical** when parse → serialize reproduces it
byte-for-byte. Canonical bytes are whatever the reference serializers emit;
the definition is intentionally behavioral, so conformance is checkable by
round-trip rather than by prose.

- Valid-but-not-canonical is a normal state (hand-reformatted files, other
  writers' whitespace). Readers accept it; `verify` reports it as
  non-canonical. Comparison is raw string equality, never normalized.
- The `generator` stamp is part of the canonical bytes: a porter-stamped file
  and a plugin-stamped file differ — validly — by exactly that field.
  Verification reads the stamp from the file itself and reproduces it, so
  either first-party writer's canonical output verifies as canonical; a
  reordered or non-typed stamp reads as non-canonical.
- Markdown canonical bytes are host-dependent by design: the YAML dumper is
  injected (`YamlPort` — the plugin uses Obsidian's `stringifyYaml`, the
  porter the `yaml` package), so quoting and folding of long or
  special-character values can differ between hosts. Round-trip stability
  holds within each host; cross-host byte-identity is not a goal.

**Zip entry names** (bulk exports): `<date> <slug> <id6>.curt`. Entry names
are not part of the parse contract — readers take conversations from entry
contents, never from names.

## Compatibility rules

Readers MUST:

- **R1** accept any valid file regardless of `generator` — ignore it entirely.
- **R2** ignore unknown fields on the envelope, conversation, message, and
  marker (forward compatibility).
- **R3** reject a file whose magic, version, or signature fails — never guess,
  never salvage.
- **R4** never reassign ids present in a native file.
- **R5** treat an unparseable markdown marker as content, never as a boundary.

Writers MUST:

- **W1** assign ids per the Identifier rules; fresh ids on foreign import,
  never reassignment on native round-trip.
- **W2** stamp `generator` as `<own app>@<own version>`, or omit it when
  unversioned — never a hardcoded value.
- **W3** emit every required field on the conversation and every message.
- **W4** apply both markdown escaping rules exactly.
- **W5** write `.curt` (not markdown) when unknown or experimental fields must
  survive — the markdown projection drops them.

## Versioning

`version: 1` is the only defined version. Additive optional fields do not bump
it (readers ignore unknowns, R2). Any change that removes or renames a
required field, changes the magic string, or breaks R1–R5 requires version 2
and a revision of this document.

The spec is pinned to a plugin release, not to the plugin's HEAD. When the
plugin's parsers change in a released version, re-copy the vendored oracles,
update the pin in the header and at the top of this file, and let the contract
suite report what moved.

## Conformance

An implementation conforms when the shared contract suite passes against its
parsers and serializers:

- `test/curtis-reference/` — the vendored plugin parsers, the standalone
  oracle. `curtis-contract.test.ts` runs the suite against it; this is the
  gate every build must pass.
- `test/curtis-contract-live.test.ts` — the same suite against the live plugin
  repo when it is checked out alongside; catches drift between the pin and
  the shipping plugin the moment it happens.
- `src/core/verify.ts` — the user-visible checker behind `porter verify`;
  applies the canonical-form definition above to real files.

The suite lives in `test/contract-assertions.ts`; tests tagged `[R#]` / `[W#]`
pin this document's compatibility rules one-for-one, so a rule without a green
test on both parser pairs is a gap in conformance, not a done deal. Both
implementations stay conformant by keeping it green on both sides — the spec
is what it tests.
