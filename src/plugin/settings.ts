// Curtis AI Porter settings.

import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type PorterPlugin from './main';
import { PORTER_ICON_ID } from './icons';
import { NMOJI_DATA_URI } from './nmoji';

export interface PorterSettings {
	/** Vault folder where ported conversations are written. */
	outputFolder: string;
	/** Also write a .curt copy next to each transcript. */
	saveCurt: boolean;
}

export const DEFAULT_SETTINGS: PorterSettings = {
	outputFolder: 'AI/Conversations',
	saveCurt: true,
};

// Shared copy — the rows are built twice (declarative definitions for app
// 1.13+, display() for older versions) and must stay in lockstep.
const OUTPUT_FOLDER_NAME = 'Output folder';
const OUTPUT_FOLDER_DESC =
	'Where ported conversations are written. With Curtis AI Chat installed, use its conversations folder (default AI/Conversations) and imports appear in chat history; without it, they are plain markdown notes.';
const SAVE_CURT_NAME = 'Also save .curt copies';
const SAVE_CURT_DESC =
	'Writes a portable .curt file next to each transcript — backups, sharing, and re-import into Curtis on any machine.';
const IDEMPOTENT_NAME = 'Re-running is safe';
const IDEMPOTENT_DESC =
	'Conversations already in the output folder (same title and length) are skipped, so porting the same export twice never duplicates chats.';

export class PorterSettingTab extends PluginSettingTab {
	private plugin: PorterPlugin;

	constructor(app: App, plugin: PorterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Declarative settings (1.13+): same rows display() builds, so the tab
	// participates in Obsidian's settings search.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				control: { type: 'text', key: 'outputFolder', placeholder: 'AI/Conversations' },
				name: OUTPUT_FOLDER_NAME,
				desc: OUTPUT_FOLDER_DESC,
			},
			{
				control: { type: 'toggle', key: 'saveCurt' },
				name: SAVE_CURT_NAME,
				desc: SAVE_CURT_DESC,
			},
			{ name: IDEMPOTENT_NAME, desc: IDEMPOTENT_DESC },
			{
				name: 'About',
				searchable: false,
				render: (setting) => this.fillAbout(setting),
			},
		];
	}

	// Keep the display() path's trim-and-fallback normalization, so both
	// write paths persist identical values.
	setControlValue(key: string, value: unknown): void | Promise<void> {
		if (key === 'outputFolder' && typeof value === 'string') {
			this.plugin.settings.outputFolder = value.trim() || DEFAULT_SETTINGS.outputFolder;
		} else if (key === 'saveCurt' && typeof value === 'boolean') {
			this.plugin.settings.saveCurt = value;
		} else {
			return;
		}
		void this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(OUTPUT_FOLDER_NAME)
			.setDesc(OUTPUT_FOLDER_DESC)
			.addText((text) => {
				text.setPlaceholder('AI/Conversations').setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
					this.plugin.settings.outputFolder = v.trim() || DEFAULT_SETTINGS.outputFolder;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(SAVE_CURT_NAME).setDesc(SAVE_CURT_DESC).addToggle((toggle) => {
			toggle.setValue(this.plugin.settings.saveCurt).onChange(async (v) => {
				this.plugin.settings.saveCurt = v;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl).setName(IDEMPOTENT_NAME).setDesc(IDEMPOTENT_DESC);

		this.addAbout();
	}

	private addAbout(): void {
		this.fillAbout(new Setting(this.containerEl));
	}

	// About footer — same lockup as the Curtis AI Chat settings footer: the
	// monoline mark repainted identity-green, version, one-line pitch,
	// author. Everything lives in one wrapper div because settingEl is a
	// flex row and bare children would sit side by side.
	private fillAbout(about: Setting): void {
		about.settingEl.addClass('porter-about');
		about.settingEl.empty();

		const wrap = about.settingEl.createDiv({ cls: 'porter-about-wrap' });
		const title = wrap.createDiv({ cls: 'porter-about-title' });
		const mark = title.createSpan({ cls: 'porter-about-mark', attr: { 'aria-hidden': 'true' } });
		// Registered by main.ts (addIcon) at startup.
		setIcon(mark, PORTER_ICON_ID);
		title.appendText(`Curtis AI Porter v${this.plugin.manifest.version}`);

		wrap.createEl('p', {
			cls: 'porter-about-desc',
			text: 'Chat porting for Obsidian — ChatGPT, Claude, Grok, Gemini, DeepSeek or any transcript into .curt files and vault-ready markdown. Local-first, open source.',
		});

		const author = wrap.createEl('p', { cls: 'porter-about-desc' });
		author.appendText('By ');
		const link = author.createEl('a', { href: 'https://github.com/JordanNewell/curtis-ai-porter' });
		link.setText('Jordan Newell');

		// Author brand mark, pinned to the footer's bottom-right corner (CSS).
		const nmoji = wrap.createDiv({ cls: 'porter-about-nmoji' });
		const nmojiLink = nmoji.createEl('a', {
			href: 'https://github.com/JordanNewell',
			attr: { 'aria-label': 'Newell' },
		});
		nmojiLink.createEl('img', { attr: { src: NMOJI_DATA_URI, alt: '' } });
	}
}
