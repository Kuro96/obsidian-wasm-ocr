import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
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

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    // --- Model Management ---
    new Setting(containerEl).setName('Model Management').setHeading();
    const modelStatusDiv = containerEl.createDiv();
    const modelsExist = this.plugin.ocrEngine
      ? await this.plugin.ocrEngine.checkModels()
      : false;

    modelStatusDiv.setText(
      modelsExist
        ? '✅ OCR models are installed.'
        : '❌ OCR models are missing.',
    );

    modelStatusDiv.addClass('ocr-model-status');
    modelStatusDiv.addClass(modelsExist ? 'success' : 'error');

    new Setting(containerEl)
      .setName('Download/update models')
      .setDesc('Download the necessary binary model files')
      .addButton((btn) => {
        btn.setButtonText(
          modelsExist ? 'Redownload models' : 'Download models',
        );
        if (!modelsExist) btn.setCta();

        btn.onClick(async () => {
          if (!this.plugin.ocrEngine) return;
          btn.setButtonText('Downloading...').setDisabled(true);
          try {
            await this.plugin.ocrEngine.downloadModels(
              (msg) => new Notice(msg),
            );
            new Notice('Models downloaded successfully!');
            await this.display(); // Refresh UI
          } catch (e) {
            new Notice('Download failed: ' + String(e));
            btn.setButtonText('Retry').setDisabled(false);
          }
        });
      });

    new Setting(containerEl).setName('Analyze Settings').setHeading();
    new Setting(containerEl)
      .setName('Auto analyze on paste')
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
      .setName('Auto analyze delay in ms')
      .setDesc(
        'Time to wait before analyzing after pasting. Allows other plugins to process the file first.',
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
      .setName('Auto open panel')
      .setDesc(
        'Automatically open the analysis side panel when starting an analyze task.',
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
      .setName('Auto merge newlines')
      .setDesc(
        'Default state for the "merge newlines" toggle. Merges broken lines based on punctuation logic.',
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
      .setName('Text recognition confidence threshold')
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
            await this.plugin.applySettings();
          }),
      );
  }
}
