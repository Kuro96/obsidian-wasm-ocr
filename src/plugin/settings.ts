import { App, PluginSettingTab, Setting } from 'obsidian';
import OcrPlugin from './main';

export interface OcrSettings {
  autoOcrOnPaste: boolean;
  autoOcrDelay: number;
  autoOpenPanel: boolean;
  autoMergeLines: boolean;
  textConfidenceThreshold: number;
}

export const DEFAULT_SETTINGS: OcrSettings = {
  autoOcrOnPaste: false,
  autoOcrDelay: 2000,
  autoOpenPanel: true,
  autoMergeLines: false,
  textConfidenceThreshold: 0.8,
};

export class OcrSettingTab extends PluginSettingTab {
  plugin: OcrPlugin;

  constructor(app: App, plugin: OcrPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'OCR Plugin Settings' });

    new Setting(containerEl)
      .setName('Auto-OCR on Paste')
      .setDesc(
        'Automatically analyze images when they are pasted into the editor.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOcrOnPaste)
          .onChange(async (value) => {
            this.plugin.settings.autoOcrOnPaste = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Auto-OCR Delay (ms)')
      .setDesc(
        'Time to wait before starting OCR after pasting. Allows other plugins (e.g. Image Renamer) to process the file first.',
      )
      .addText((text) =>
        text
          .setPlaceholder('2000')
          .setValue(String(this.plugin.settings.autoOcrDelay))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num)) {
              this.plugin.settings.autoOcrDelay = num;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('Auto-Open Panel')
      .setDesc(
        'Automatically open the analysis side panel when starting an OCR task.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenPanel)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenPanel = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Auto-Merge Newlines')
      .setDesc(
        'Default state for the "Merge Newlines" toggle. Merges broken lines based on punctuation logic.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoMergeLines)
          .onChange(async (value) => {
            this.plugin.settings.autoMergeLines = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Text Recognition Confidence Threshold')
      .setDesc(
        'Minimum confidence score (0.0 - 1.0) for a text block to be included. Higher values reduce noise but may miss faint text.',
      )
      .addSlider((slider) =>
        slider
          .setLimits(0.0, 1.0, 0.05)
          .setValue(this.plugin.settings.textConfidenceThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.textConfidenceThreshold = value;
            await this.plugin.saveSettings();
            this.plugin.applySettings();
          }),
      );
  }
}
