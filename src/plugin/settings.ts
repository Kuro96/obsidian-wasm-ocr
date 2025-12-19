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

    containerEl.createEl('h2', { text: 'OCR Plugin Settings' });

    // --- Model Management ---
    containerEl.createEl('h3', { text: 'Model Management' });
    const modelStatusDiv = containerEl.createDiv();
    const modelsExist = this.plugin.ocrEngine
      ? await this.plugin.ocrEngine.checkModels()
      : false;

    modelStatusDiv.setText(
      modelsExist
        ? '✅ OCR Models are installed.'
        : '❌ OCR Models are missing.',
    );
    modelStatusDiv.style.color = modelsExist
      ? 'var(--color-green)'
      : 'var(--color-red)';
    modelStatusDiv.style.marginBottom = '10px';

    new Setting(containerEl)
      .setName('Download/Update Models')
      .setDesc('Download the necessary NCNN models from GitHub (approx. 11MB).')
      .addButton((btn) => {
        btn.setButtonText(
          modelsExist ? 'Re-download Models' : 'Download Models',
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
            this.display(); // Refresh UI
          } catch (e) {
            new Notice('Download failed: ' + String(e));
            btn.setButtonText('Retry').setDisabled(false);
          }
        });
      });

    containerEl.createEl('hr');
    // ------------------------

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
