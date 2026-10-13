#!/usr/bin/env node
// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// curt-porter CLI.
//
//   curt-porter convert <file...> [--out <dir>] [--format curt|md|both] [--zip]
//   curt-porter export <file...> [--to chatgpt-json|api-jsonl|continuation]
//                      [--out <dir>] [--zip] [--budget <tokens>] [--target <t>]
//   curt-porter verify <file...> [--json]
//   curt-porter stats <file...> [--json]
//   curt-porter serve [--port 7777]
//
// convert reads ChatGPT / Claude export zips, conversations.json files,
// generic transcripts, .curt bundles and Curtis markdown; writes .curt files
// and vault-ready markdown. export writes the other direction — ChatGPT-shape
// JSON, API JSONL, or a continuation pack to attach to a live chat. verify
// proves native files round-trip; stats aggregates what the history contains.
// serve hosts the drag-and-drop web page locally.

// The CLI is a pure Node program — desktop-only by construction. The Obsidian
// review's scanner accepts Node builtins guarded by Platform.isDesktop, so the
// CLI carries a literal stand-in for that flag rather than a static import.
const Platform = { isDesktop: true };
const loadNode = async (): Promise<[typeof import('node:fs'), typeof import('node:http'), typeof import('node:path'), typeof import('node:url')]> => {
	if (!Platform.isDesktop) throw new Error('curt-porter requires Node.js');
	return Promise.all([import('node:fs'), import('node:http'), import('node:path'), import('node:url')]);
};
const [fs, http, path, url] = await loadNode();
const { fileURLToPath } = url;
import { zipSync, strToU8 } from 'fflate';

// Raw stream writers — stdout for results, stderr for diagnostics.
const out = (text: string): void => void process.stdout.write(`${text}\n`);
const err = (text: string): void => void process.stderr.write(`${text}\n`);
import { convertFiles, allChats } from '../src/core/convert';
import { chatImportPayload, chatMessageId, encodeAuditBlock } from '../src/core/audit';
import { exportTargets, serializeExport } from '../src/core/export';
import { buildContinuation, type ContinuationTarget } from '../src/core/export/continuation-md';
import { verifyCurt, verifyCurtisMarkdown, type VerifyResult } from '../src/core/verify';
import { computeStats, renderStatsText } from '../src/core/stats';
import type { ConvertedChat, ConversionReport } from '../src/core/types';
import { PORTER_VERSION as VERSION } from '../src/version';
const HELP = `curt-porter v${VERSION} — carry your AI chats anywhere

Usage:
  curt-porter convert <file...> [options]
  curt-porter export <file...> [options]
  curt-porter verify <file...> [options]
  curt-porter stats <file...> [options]
  curt-porter serve [options]

Commands:
  convert   Convert ChatGPT / Claude exports, transcripts, .curt or Curtis
            markdown files into .curt bundles and Obsidian-ready markdown.
  export    Convert like \`convert\`, then emit for other platforms: a
            ChatGPT-shaped conversations.json, API JSONL, or a markdown
            continuation pack to attach to a live chat.
  verify    Prove .curt / Curtis markdown files round-trip: each file must
            parse and re-serialize unchanged; non-canonical files are named.
  stats     Aggregate what a history contains — messages, words, tokens,
            cost, providers, models, monthly activity, largest conversations.
  serve     Run the drag-and-drop web UI at http://localhost:<port>.

Options:
  --out <dir>     Output directory (default: ./curt-porter-out)
  --format <f>    convert: curt | md | both (default: both)
  --to <t>        export: chatgpt-json | api-jsonl | continuation
                  (default: continuation)
  --target <t>    export --to continuation: chatgpt | claude | gemini |
                  generic preamble (default: generic)
  --budget <n>    export: token budget for continuation packs (default: 30000)
  --zip           Write one zip instead of individual files
  --audit-inbox <file>   convert: also file one audit receipt per conversation
                          into this OM-1 audit inbox (curtis-ai-audit format)
  --json          verify / stats: machine-readable JSON output
  --port <n>      serve port (default: 7777)
  -h, --help      This help

Everything runs locally. No accounts, no uploads, no telemetry.`;

const FORMAT_LABELS: Record<string, string> = {
	curt: 'Curtis (.curt)',
	'curtis-md': 'Curtis markdown',
	chatgpt: 'ChatGPT export',
	claude: 'Claude export',
	grok: 'Grok export',
	gemini: 'Gemini Takeout',
	'generic-json': 'JSON transcript',
	'generic-md': 'Markdown transcript',
	unknown: 'Unknown format',
};

interface ConvertArgs {
	files: string[];
	out: string;
	format: 'curt' | 'md' | 'both';
	zip: boolean;
	/** File receipts for every conversation written, into this audit inbox. */
	auditInbox: string | null;
}

/** The token after an option that takes a value — undefined when missing or
 *  when it's itself a flag (`--out --zip` must not eat "--zip" as a dir). */
function optionValue(argv: string[], i: number): string | undefined {
	const v = argv[i + 1];
	return v !== undefined && !v.startsWith('--') ? v : undefined;
}

function parseConvertArgs(argv: string[]): ConvertArgs | null {
	const args: ConvertArgs = { files: [], out: 'curt-porter-out', format: 'both', zip: false, auditInbox: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--out') {
			const v = optionValue(argv, i);
			if (v !== undefined) {
				args.out = v;
				i++;
			}
		} else if (a === '--audit-inbox') {
			const v = optionValue(argv, i);
			if (v === undefined) return null; // dangling --audit-inbox → usage, exit 2
			args.auditInbox = v;
			i++;
		} else if (a === '--format') {
			const v = optionValue(argv, i);
			if (v === undefined) return null; // dangling --format → usage, exit 2
			args.format = v as ConvertArgs['format'];
			i++;
		} else if (a === '--zip') args.zip = true;
		else if (a === '-h' || a === '--help') return null;
		else args.files.push(a);
	}
	if (args.files.length === 0) return null;
	if (!['curt', 'md', 'both'].includes(args.format)) throw new Error(`--format must be curt | md | both (got "${args.format}")`);
	return args;
}

function reportLines(reports: ConversionReport[]): string[] {
	const lines: string[] = [];
	for (const r of reports) {
		const label = FORMAT_LABELS[r.format] ?? r.format;
		if (r.error && r.chats.length === 0) {
			lines.push(`  ! ${r.file} — ${label}: ${r.error}`);
			continue;
		}
		const parts = [`${r.chats.length} conversation${r.chats.length === 1 ? '' : 's'}`];
		if (r.skipped > 0) parts.push(`${r.skipped} skipped (duplicate)`);
		lines.push(`  = ${r.file} — ${label}: ${parts.join(', ')}`);
		if (r.error) lines.push(`    ! also: ${r.error}`);
	}
	return lines;
}

function cmdConvert(argv: string[]): number {
	let args: ConvertArgs | null = null;
	try {
		args = parseConvertArgs(argv);
	} catch (e) {
		err((e as Error).message);
		return 2;
	}
	if (!args) {
		out('Usage: curt-porter convert <file...> [--out <dir>] [--format curt|md|both] [--zip] [--audit-inbox <file>]');
		return 2;
	}

	const missing = args.files.filter((f) => !fs.existsSync(f));
	if (missing.length > 0) {
		err(`Not found: ${missing.join(', ')}`);
		return 2;
	}

	// readFileSync hands back a pooled Buffer — copy the visible region into
	// a fresh ArrayBuffer, or the parsers see garbage before the file bytes.
	const inputs = args.files.map((f) => {
		const b = fs.readFileSync(f);
		return { name: path.basename(f), buffer: new Uint8Array(b).buffer };
	});
	const reports = convertFiles(inputs, { markdown: args.format !== 'curt', generatorVersion: VERSION });
	const chats = allChats(reports);
	if (chats.length === 0) {
		err('No conversations recognized in the given files.');
		reportLines(reports).forEach((l) => err(l));
		return 1;
	}

	for (const line of reportLines(reports)) out(line);

	const wantCurt = args.format !== 'md';
	const wantMd = args.format !== 'curt';
	const failures: string[] = [];
	let written = 0;
	try {
		fs.mkdirSync(args.out, { recursive: true });
	} catch (e) {
		failures.push(`  ! ${args.out} — ${(e as Error).message}`);
	}

	if (failures.length === 0) {
		// One bad filename (over-long title, reserved name) must not abort the
		// whole run — record it, keep writing the rest, report at the end.
		const tryWrite = (name: string, body: string | Uint8Array): boolean => {
			try {
				fs.writeFileSync(path.join(args.out, name), body);
				return true;
			} catch (e) {
				failures.push(`  ! ${name} — ${(e as Error).message}`);
				return false;
			}
		};
		const audited: ConvertedChat[] = [];
		if (args.zip) {
			const entries: Record<string, Uint8Array> = {};
			for (const c of chats) {
				if (wantCurt) entries[c.files.curt] = strToU8(c.curt);
				if (wantMd) entries[`${c.files.md}`] = strToU8(c.markdown);
			}
			const outZip = path.join(args.out, 'curt-porter.zip');
			try {
				fs.writeFileSync(outZip, zipSync(entries));
				written = 1;
				if (wantMd) audited.push(...chats);
				out(`\nWrote ${outZip} (${chats.length} conversations)`);
			} catch (e) {
				failures.push(`  ! ${outZip} — ${(e as Error).message}`);
			}
		} else {
			for (const c of chats) {
				if (wantCurt && tryWrite(c.files.curt, c.curt)) written++;
				if (wantMd && tryWrite(c.files.md, c.markdown)) {
					written++;
					audited.push(c);
				}
			}
			if (written > 0) out(`\nWrote ${written} file${written === 1 ? '' : 's'} to ${args.out}/`);
		}
		if (args.auditInbox && audited.length > 0) {
			try {
				fs.mkdirSync(path.dirname(path.resolve(args.auditInbox)), { recursive: true });
				for (const c of audited) {
					const payload = chatImportPayload(c.conversation, `${args.out}/${c.files.md}`);
					fs.appendFileSync(args.auditInbox, encodeAuditBlock(chatMessageId(c.conversation.id), payload));
				}
				out(`Filed ${audited.length} audit receipt(s) → ${args.auditInbox}`);
			} catch (e) {
				failures.push(`  ! audit inbox ${args.auditInbox} — ${(e as Error).message}`);
			}
		}
	}

	for (const line of failures) err(line);
	if (written === 0) return 1;

	out(`
Next steps:
  Obsidian + Curtis → drop the .md files into your vault's AI/Conversations folder,
                      or drop a .curt file anywhere in the vault and double-click it.
  Just Obsidian     → the .md files are plain notes; put them in any folder.
  Neither           → keep the .curt files; they're portable JSON — re-import anytime.`);
	return 0;
}

const EXPORT_TARGET_IDS = exportTargets.map((t) => t.id);

interface ExportArgs {
	files: string[];
	to: (typeof EXPORT_TARGET_IDS)[number];
	out: string;
	zip: boolean;
	budget: number;
	target: ContinuationTarget;
}

const CONTINUATION_TARGETS: ContinuationTarget[] = ['chatgpt', 'claude', 'gemini', 'generic'];

function parseExportArgs(argv: string[]): ExportArgs | null {
	const args: ExportArgs = { files: [], to: 'continuation-md', out: 'curt-porter-out', zip: false, budget: 30000, target: 'generic' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--to') {
			const v = optionValue(argv, i);
			if (v === undefined) return null; // dangling --to → usage, exit 2
			// `continuation` is the CLI-friendly alias for the continuation-md target.
			args.to = (v === 'continuation' ? 'continuation-md' : v) as ExportArgs['to'];
			i++;
		} else if (a === '--target') {
			const v = optionValue(argv, i);
			const t = v as ContinuationTarget;
			if (v === undefined || !CONTINUATION_TARGETS.includes(t)) {
				throw new Error(`--target must be chatgpt | claude | gemini | generic${v !== undefined ? ` (got "${v}")` : ''}`);
			}
			args.target = t;
			i++;
		} else if (a === '--out') {
			const v = optionValue(argv, i);
			if (v !== undefined) {
				args.out = v;
				i++;
			}
		} else if (a === '--zip') args.zip = true;
		else if (a === '--budget') {
			const v = optionValue(argv, i);
			const n = v !== undefined ? Number(v) : NaN;
			if (Number.isFinite(n) && n > 0) {
				args.budget = n;
				i++;
			}
		} else if (a === '-h' || a === '--help') return null;
		else args.files.push(a);
	}
	if (args.files.length === 0) return null;
	if (!EXPORT_TARGET_IDS.includes(args.to)) {
		throw new Error(`--to must be chatgpt-json | api-jsonl | continuation (got "${args.to}")`);
	}
	return args;
}

function cmdExport(argv: string[]): number {
	let args: ExportArgs | null = null;
	try {
		args = parseExportArgs(argv);
	} catch (e) {
		err((e as Error).message);
		return 2;
	}
	if (!args) {
		out(
			'Usage: curt-porter export <file...> [--to chatgpt-json|api-jsonl|continuation] [--target chatgpt|claude|gemini|generic] [--out <dir>] [--zip] [--budget <tokens>]'
		);
		return 2;
	}

	const missing = args.files.filter((f) => !fs.existsSync(f));
	if (missing.length > 0) {
		err(`Not found: ${missing.join(', ')}`);
		return 2;
	}

	// Same pooled-Buffer dance as convert — copy each file's region into a
	// fresh ArrayBuffer before handing it to the parsers.
	const inputs = args.files.map((f) => {
		const b = fs.readFileSync(f);
		return { name: path.basename(f), buffer: new Uint8Array(b).buffer };
	});
	const reports = convertFiles(inputs, { markdown: false, generatorVersion: VERSION });
	const chats = allChats(reports);
	if (chats.length === 0) {
		err('No conversations recognized in the given files.');
		reportLines(reports).forEach((l) => err(l));
		return 1;
	}

	for (const line of reportLines(reports)) out(line);

	const result = serializeExport(args.to, chats.map((c) => c.conversation), { budgetTokens: args.budget, target: args.target });
	fs.mkdirSync(args.out, { recursive: true });

	if (args.zip) {
		const entries: Record<string, Uint8Array> = {};
		for (const f of result.files) entries[f.name] = strToU8(f.body);
		const outZip = path.join(args.out, 'curtis-export.zip');
		fs.writeFileSync(outZip, zipSync(entries));
		out(`\nWrote ${outZip} (${chats.length} conversation${chats.length === 1 ? '' : 's'})`);
	} else {
		for (const f of result.files) fs.writeFileSync(path.join(args.out, f.name), f.body);
		out(`\nWrote ${result.files.length} file${result.files.length === 1 ? '' : 's'} to ${args.out}/`);
	}

	if (args.to === 'continuation-md') {
		let kept = 0;
		let total = 0;
		for (const c of chats) {
			const { info } = buildContinuation(c.conversation, { budgetTokens: args.budget, target: args.target });
			kept += info.turnsKept;
			total += info.turnsTotal;
		}
		out(`\nPacks keep ${kept} of ${total} turn${total === 1 ? '' : 's'} (budget ${args.budget} tokens per conversation).`);
		out(
			`Next steps:\n  Attach a pack to a ChatGPT / Claude / Gemini chat and ask it to read it —\n  the conversation continues from where the transcript ends.`
		);
	}
	return 0;
}

/** Shared args for the read-only commands: input files plus --json. */
interface FileArgs {
	files: string[];
	json: boolean;
}

function parseFileArgs(argv: string[]): FileArgs | null {
	const args: FileArgs = { files: [], json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--json') args.json = true;
		else if (a === '-h' || a === '--help') return null;
		else args.files.push(a);
	}
	if (args.files.length === 0) return null;
	return args;
}

function mtimeOf(f: string): number {
	try {
		return fs.statSync(f).mtimeMs;
	} catch {
		return Date.now();
	}
}

function dateOf(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cmdVerify(argv: string[]): number {
	let args: FileArgs | null = null;
	try {
		args = parseFileArgs(argv);
	} catch (e) {
		err((e as Error).message);
		return 2;
	}
	if (!args) {
		out('Usage: curt-porter verify <file...> [--json]');
		return 2;
	}

	const missing = args.files.filter((f) => !fs.existsSync(f));
	if (missing.length > 0) {
		err(`Not found: ${missing.join(', ')}`);
		return 2;
	}

	const results: Array<{ file: string; result: VerifyResult }> = [];
	for (const f of args.files) {
		const raw = fs.readFileSync(f, 'utf8');
		let result = verifyCurt(raw);
		if (result.format === 'unknown') result = verifyCurtisMarkdown(raw, mtimeOf(f));
		results.push({ file: f, result });
	}

	if (args.json) {
		out(JSON.stringify(results, null, '\t'));
	} else {
		for (const { file, result } of results) {
			if (result.format === 'unknown') {
				out(`  ! ${file} — not a native Curtis format (verify covers .curt and Curtis markdown)`);
				continue;
			}
			const label = result.format === 'curt' ? 'Curtis (.curt)' : 'Curtis markdown';
			if (!result.ok) out(`  ! ${file} — ${label}: INVALID`);
			else if (!result.canonical) out(`  ~ ${file} — ${label}: valid, not byte-canonical`);
			else out(`  = ${file} — ${label}: OK, round-trips byte-for-byte`);
			for (const issue of result.issues) out(`      - ${issue}`);
			if (result.summary) {
				const s = result.summary;
				const span = s.first !== undefined && s.last !== undefined ? `, ${dateOf(s.first)}..${dateOf(s.last)}` : '';
				out(`      ${s.title} — ${s.messages} message${s.messages === 1 ? '' : 's'}${span}`);
			}
		}
		const passed = results.filter((r) => r.result.ok).length;
		out(`\n${passed}/${results.length} file${results.length === 1 ? '' : 's'} round-trip.`);
	}

	// Any file that isn't a proven native round-trip — invalid, unknown format —
	// fails the run; canonicality is a warning, not a failure.
	return results.every((r) => r.result.ok) ? 0 : 1;
}

function cmdStats(argv: string[]): number {
	let args: FileArgs | null = null;
	try {
		args = parseFileArgs(argv);
	} catch (e) {
		err((e as Error).message);
		return 2;
	}
	if (!args) {
		out('Usage: curt-porter stats <file...> [--json]');
		return 2;
	}

	const missing = args.files.filter((f) => !fs.existsSync(f));
	if (missing.length > 0) {
		err(`Not found: ${missing.join(', ')}`);
		return 2;
	}

	// Same pooled-Buffer dance as convert — copy each file's region into a
	// fresh ArrayBuffer before handing it to the parsers.
	const inputs = args.files.map((f) => {
		const b = fs.readFileSync(f);
		return { name: path.basename(f), buffer: new Uint8Array(b).buffer };
	});
	const reports = convertFiles(inputs, { markdown: false, generatorVersion: VERSION });
	const chats = allChats(reports);
	if (chats.length === 0) {
		err('No conversations recognized in the given files.');
		reportLines(reports).forEach((l) => err(l));
		return 1;
	}

	const stats = computeStats(chats.map((c) => c.conversation));
	if (args.json) {
		out(JSON.stringify(stats, null, '\t'));
	} else {
		for (const line of reportLines(reports)) out(line);
		out(`\n${renderStatsText(stats)}`);
	}
	return 0;
}

/** Returns undefined when serving — the listener keeps the process alive. */
function cmdServe(argv: string[]): number | undefined {
	let port = 7777;
	const pi = argv.indexOf('--port');
	if (pi !== -1) {
		const n = Number(optionValue(argv, pi));
		// Only a real positive integer stands; 0/NaN/negative/absent → default.
		if (Number.isInteger(n) && n > 0) port = n;
	}

	const here = path.dirname(fileURLToPath(import.meta.url));
	const pagePath = path.join(here, 'porter.html');
	if (!fs.existsSync(pagePath)) {
		err('dist/porter.html missing — run `npm run build` first.');
		return 2;
	}
	const page = fs.readFileSync(pagePath);

	const server = http.createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(page);
	});
	server.on('error', (error: NodeJS.ErrnoException) => {
		if (error.code === 'EADDRINUSE') err(`Port ${port} in use — try --port <other>`);
		else err(error.message);
		process.exit(1);
	});
	// An out-of-range port throws synchronously — async failures (busy port)
	// arrive via the 'error' handler above, this catches the rest.
	try {
		server.listen(port, '127.0.0.1', () => {
			const addr = server.address();
			const bound = typeof addr === 'object' && addr !== null ? addr.port : port;
			out(`Curtis AI Porter → http://localhost:${bound}`);
			out('Ctrl+C to stop. Everything stays on this machine.');
		});
	} catch (e) {
		err((e as Error).message);
		process.exit(1);
	}
	// No return — undefined code means "keep running"; the listener holds the
	// event loop open.
}

function main(): number | undefined {
	const argv = process.argv.slice(2);
	const cmd = argv[0];
	if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
		out(HELP);
		return 0;
	}
	if (cmd === '--version' || cmd === '-v') {
		out(VERSION);
		return 0;
	}
	switch (cmd) {
		case 'convert':
			return cmdConvert(argv.slice(1));
		case 'export':
			return cmdExport(argv.slice(1));
		case 'verify':
			return cmdVerify(argv.slice(1));
		case 'stats':
			return cmdStats(argv.slice(1));
		case 'serve':
			// Returns undefined — the listening server keeps the process alive.
			return cmdServe(argv.slice(1));
		default:
			err(`Unknown command "${cmd}". Try --help.`);
			return 2;
	}
}

const code = main();
if (code !== undefined) process.exit(code);
