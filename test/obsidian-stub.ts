// Minimal 'obsidian' stand-in so the contract tests can run the REAL Curtis
// plugin parsers (chat/conversation-format.ts, import/curt-format.ts) under
// node:test. Only the names those modules use at runtime are implemented;
// yaml-backed parseYaml/stringifyYaml match Obsidian's js-yaml semantics
// closely enough for the flat frontmatter the transcript format uses.

import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

export class Notice {
	constructor(public message: string, _duration?: number) {}
	hide(): void {}
}

export class TFile {
	path = '';
	stat = { mtime: 0, ctime: 0, size: 0 };
}

export class App {}

export function parseYaml<T = unknown>(input: string): T {
	return yamlParse(input) as T;
}

export function stringifyYaml(value: unknown): string {
	return yamlStringify(value);
}
