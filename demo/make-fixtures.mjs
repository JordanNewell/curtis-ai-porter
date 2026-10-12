// Demo fixture generator — realistic AI-tool exports for trying the porter.
//   node demo/make-fixtures.mjs
// Writes into demo/fixtures/: chatgpt-export.zip, claude-export.json,
// deepseek-paste.md, curtis-chats-demo.zip (a plugin bulk-export simulation).

import { zipSync, strToU8 } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures');
mkdirSync(out, { recursive: true });

// ---- ChatGPT export (mapping tree, system node, model slugs) ----

const gptConv = (title, t0, turns, model = "gpt-5.1") => ({
	title,
	create_time: t0,
	update_time: t0 + turns.length * 30,
	mapping: Object.fromEntries([
		["root", {}],
		["sys", { message: { author: { role: "system" }, content: { content_type: "text", parts: ["You are ChatGPT."] }, create_time: t0 - 1 } }],
		...turns.map(([role, text], i) => [
			`node-${i}`,
			{
				message: {
					author: { role },
					content: { content_type: "text", parts: [text] },
					create_time: t0 + i * 30,
					metadata: role === "assistant" ? { model_slug: model } : {},
				},
			},
		]),
	]),
});

const chatgpt = [
	gptConv("Kyoto in November", 1735516800, [
		["user", "Three days in Kyoto in mid-November — what should I not miss?"],
		["assistant", "Mid-November is peak momiji (maple) season. Non-negotiables:\n\n1. **Fushimi Inari at sunrise** — you'll have the torii gates nearly alone.\n2. **Eikando temple** in the late afternoon — the evening illuminations start mid-month.\n3. **Arashiyama** on a weekday morning, before the bamboo grove gets loud.\n\nWant me to sketch a day-by-day plan?"],
		["user", "Yes please, and keep it walkable"],
		["assistant", "Here's a walkable three-day plan:\n\n**Day 1 — Higashiyama:** Kiyomizu-dera at opening → Sannenzaka lanes → Kodai-ji → Gion by dusk.\n**Day 2 — Arashiyama:** bamboo grove at 7am → Tenryu-ji gardens → riverbank walk → Sagano scenic railway.\n**Day 3 — Fushimi + downtown:** Inari sunrise → sake district tastings → Nishiki Market lunch."],
	]),
	gptConv("Kubernetes blue-green rollout", 1735689600, [
		["user", "How do I do a blue-green rollout of my API on k8s?"],
		["assistant", "Run two deployments and flip the Service selector once green is healthy:\n\n```yaml\nkind: Service\nspec:\n  selector:\n    app: api\n    version: green   # flip from blue to green here\n```\n\nWatch the green deployment's readiness gates before the flip, and keep blue around for instant rollback."],
		["user", "And the database migration?"],
		["assistant", "Migrations go first, but only the backward-compatible kind: add columns nullable, dual-write, backfill, then drop later. Never deploy schema and code that only work together in the same minute."],
	], "gpt-4o"),
	gptConv("Sourdough emergency", 1735603200, [
		["user", "My starter smells like nail polish remover and has grey liquid on top"],
		["assistant", "That's hooch — acetone smell means it's starving, not dead. Pour the liquid off (or stir it in, your call), feed 1:2:2 with warm water, and keep it somewhere 24-26°C. It should double within 6-8 hours. Repeat daily and it'll smell yeasty and mildly sweet again in about three feeds."],
	]),
];

writeFileSync(path.join(out, "chatgpt-export.zip"), zipSync({ "conversations.json": strToU8(JSON.stringify(chatgpt, null, 2)) }));

// ---- Claude export (content blocks, ISO timestamps) ----

const claude = [
	{
		name: "Refactor the conversation store",
		created_at: "2026-09-01T10:00:00Z",
		updated_at: "2026-09-01T10:12:00Z",
		chat_messages: [
			{ sender: "human", text: "The conversation store does parsing, writing and watching. Where do I cut it?", created_at: "2026-09-01T10:00:00Z" },
			{
				sender: "assistant",
				content: [
					{ type: "text", text: "Extract the pure parts first — the markdown parser and serializer have no business living in the same file as the Obsidian vault plumbing." },
					{ type: "text", text: "Then the write queue: debounce + per-id serialization is its own concern. The file watcher stays last; it's the glue." },
				],
				created_at: "2026-09-01T10:01:00Z",
			},
			{ sender: "human", text: "Do that, and note the order to do it in", created_at: "2026-09-01T10:10:00Z" },
			{
				sender: "assistant",
				content: [{ type: "text", text: "Order: parser → serializer → queue → watcher. Each step compiles and the tests stay green, so you can land them as four small commits." }],
				created_at: "2026-09-01T10:12:00Z",
			},
		],
	},
	{
		name: "Sci-fi shortlist",
		created_at: "2026-08-20T18:00:00Z",
		updated_at: "2026-08-20T18:20:00Z",
		chat_messages: [
			{ sender: "human", text: "I loved A Memory Called Empire. What next?", created_at: "2026-08-20T18:00:00Z" },
			{ sender: "assistant", content: [{ type: "text", text: "Adjacent pleasures: **The Raven Tower** (Ann Leckie) for slow-burn political SF, the Teixcalaan sequel of course, and **Gideon the Ninth** if you want voice over politics." }], created_at: "2026-08-20T18:05:00Z" },
		],
	},
];
writeFileSync(path.join(out, "claude-export.json"), JSON.stringify(claude, null, 2));

// ---- DeepSeek-style copy/paste (no bulk export exists) ----

const paste = `# Rust or Go for a side project

## You

I keep going back and forth — Rust or Go for a small API side project?

## AI

For a small API with a shipping deadline, Go: you'll finish. The standard library covers HTTP, deploys are a single binary, and the borrow checker never interrupts you at 11pm.

## You

When would Rust be the right call?

## AI

When correctness under concurrency is the product — a parser, a proxy, anything where a data race is a security bug. If the fun *is* the engineering, Rust pays you back. If the fun is the finished thing, Go.
`;
writeFileSync(path.join(out, "deepseek-paste.md"), paste);

// ---- Simulated Curtis bulk export (zip of .curt files) ----

const curt = (id, title, created, turns) => ({
	curt: "curtis-conversation",
	version: 1,
	conversation: {
		id,
		title,
		createdAt: created,
		updatedAt: created + turns.length * 20000,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		messages: turns.map(([role, text], i) => ({
			id: `${id.slice(-6)}_m${i}_${created}`,
			role,
			content: text,
			timestamp: created + i * 20000,
		})),
	},
});

const bulk = zipSync({
	"2026-10-01 Vault-native thinking a1b2c3.curt": strToU8(
		JSON.stringify(
			curt("conv_1791212400000_a1b2c3", "Vault-native thinking", 1791212400000, [
				["user", "What does it mean for notes to be vault-native?"],
				["assistant", "Files are the database: plain markdown, readable by anything, syncable by everything. The AI reads and writes the same files you do — no private store, no export step."],
			]),
			null,
			"\t"
		)
	),
	"2026-10-02 Local-first means what exactly a1b2c4.curt": strToU8(
		JSON.stringify(
			curt("conv_1791298800000_a1b2c4", "Local-first means what exactly", 1791298800000, [
				["user", "People keep saying local-first. What changes practically?"],
				["assistant", "Practically: your history works offline, sync is file sync, privacy is a folder permission, and switching tools is a copy — because the data was never locked up to begin with."],
			]),
			null,
			"\t"
		)
	),
});
writeFileSync(path.join(out, "curtis-chats-demo.zip"), bulk);

console.log("fixtures written to", out);
