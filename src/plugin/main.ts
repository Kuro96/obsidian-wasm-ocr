import { Plugin, TFile, Notice, Menu, requestUrl } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { AnalysisView, VIEW_TYPE_ANALYSIS } from './views/AnalysisView';
import { OcrEngine } from './services/OcrEngine';
import { useAnalysisStore, AnalysisItem } from './models/store';
import { decodeImage } from './utils/imageUtils';
import { OcrSettings, DEFAULT_SETTINGS, OcrSettingTab } from './settings';

export default class OcrPlugin extends Plugin {
  public ocrEngine: OcrEngine | null = null;
  settings: OcrSettings;
  private lastPasteTime = 0;

  async onload() {
    await this.loadSettings();
    useAnalysisStore.getState().setMergeLines(this.settings.autoMergeLines);

    this.ocrEngine = new OcrEngine(this.app, this.manifest.dir);
    // Apply initial settings (threshold)
    await this.applySettings();

    this.registerView(VIEW_TYPE_ANALYSIS, (leaf) => new AnalysisView(leaf));

    this.addSettingTab(new OcrSettingTab(this.app, this));

    this.addRibbonIcon('scan-search', 'Recognize image', async () => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ANALYSIS);
      if (leaves.length === 0) {
        await this.activateView();
        return;
      }

      const leaf = leaves[0];
      const rightSplit = this.app.workspace.rightSplit;

      // Check if the leaf is in the right split and currently visible (active tab)
      // offsetParent is null if the element or any parent is hidden (display: none)
      if (
        rightSplit &&
        !rightSplit.collapsed &&
        leaf.view.containerEl.offsetParent
      ) {
        rightSplit.collapse();
      } else {
        await this.activateView();
      }
    });

    this.addCommand({
      id: 'ocr-analyze-current',
      name: 'Analyze current image',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (
          file &&
          ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(
            file.extension.toLowerCase(),
          )
        ) {
          if (!checking) {
            void this.analyzeFile(file);
          }
          return true;
        }
        return false;
      },
    });

    // Auto-OCR Logic for Pasted Images
    this.registerEvent(
      this.app.workspace.on('editor-paste', (evt) => {
        // Mark time if clipboard has files (potential images)
        if (evt.clipboardData && evt.clipboardData.files.length > 0) {
          this.lastPasteTime = Date.now();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (!this.settings.autoOcrOnPaste) return;

        // Check correlation with paste event (within 1.5s tolerance)
        if (Date.now() - this.lastPasteTime > 1500) return;

        if (file instanceof TFile) {
          const ext = file.extension.toLowerCase();
          if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
            // Queue analysis with configured delay to allow other plugins to move/rename
            setTimeout(() => {
              // Re-verify existence using path (robust against moves if TFile tracks it,
              // but getAbstractFileByPath ensures it's currently at the path we expect or TFile is still valid)
              const currentFile = this.app.vault.getAbstractFileByPath(
                file.path,
              );
              if (currentFile && currentFile instanceof TFile) {
                new Notice(
                  `Automatic recognition started for pasted image: ${currentFile.name}`,
                );
                void this.analyzeFile(currentFile, { auto: true });
              }
            }, this.settings.autoOcrDelay);
          }
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile) {
          const ext = file.extension.toLowerCase();
          if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
            menu.addItem((item) => {
              item
                .setTitle('Analyze image')
                .setIcon('scan-search')
                .onClick(async () => {
                  await this.analyzeFile(file);
                });
            });
          } else if (ext === 'md') {
            menu.addItem((item) => {
              item
                .setTitle('Analyze note images')
                .setIcon('files')
                .onClick(async () => {
                  await this.analyzeNote(file);
                });
            });
          }
        }
      }),
    );

    // Let's implement the specific tracking
    let lastContextTarget: HTMLElement | null = null;
    this.registerDomEvent(
      document,
      'contextmenu',
      (evt) => {
        lastContextTarget = evt.target as HTMLElement;

        // Handle Reading View (Preview) Images
        const target = evt.target as HTMLElement;
        if (
          target.tagName === 'IMG' &&
          target.closest('.markdown-preview-view')
        ) {
          const img = target as HTMLImageElement;
          const src = img.src;

          const menu = new Menu();

          menu.addItem((item) => {
            item
              .setTitle('Analyze image (beta)')
              .setIcon('scan-search')
              .onClick(async () => {
                await this.analyzeImageUrl(src);
              });
          });

          menu.showAtPosition({ x: evt.pageX, y: evt.pageY });
          evt.preventDefault();
        }
      },
      true,
    );

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        // Option to analyze selected text for images
        const selection = editor.getSelection();
        if (selection && view.file) {
          menu.addItem((item) => {
            item
              .setTitle('Analyze selected images')
              .setIcon('scan-search')
              .onClick(async () => {
                if (view.file) {
                  await this.analyzeText(selection, view.file);
                }
              });
          });
        }

        // Option to analyze all images in the current note
        if (view.file && view.file.extension === 'md') {
          menu.addItem((item) => {
            item
              .setTitle('Analyze all images in note')
              .setIcon('layers')
              .onClick(async () => {
                if (view.file) {
                  await this.analyzeNote(view.file);
                }
              });
          });
        }

        if (lastContextTarget && lastContextTarget.tagName === 'IMG') {
          const img = lastContextTarget as HTMLImageElement;
          const src = img.src;

          menu.addItem((item) => {
            item
              .setTitle('Analyze image (beta)')
              .setIcon('scan-search')
              .onClick(async () => {
                await this.analyzeImageUrl(src);
              });
          });
        }
      }),
    );

    this.addCommand({
      id: 'ocr-analyze-all-in-note',
      name: 'Analyze all images in current note',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === 'md') {
          if (!checking) {
            void this.analyzeNote(file);
          }
          return true;
        }
        return false;
      },
    });

    // Subscribe to store changes to auto-process queue
    // This allows UI components to simply add items to the store
    useAnalysisStore.subscribe((state, prevState) => {
      if (state.items !== prevState.items) {
        const hasPending = state.items.some((i) => i.status === 'pending');
        if (hasPending) {
          void this.processQueue();
        }
      }
    });
  }

  async processQueue() {
    const store = useAnalysisStore.getState();
    const items = store.items;

    if (!this.ocrEngine) return;

    let processedCount = 0;

    for (let i = 0; i < items.length; i++) {
      const currentItem = useAnalysisStore.getState().items[i];
      if (currentItem.status === 'pending') {
        store.updateItem(currentItem.id, { status: 'analyzing' });

        try {
          let imageData: ImageData;
          if (currentItem.file) {
            const arrayBuffer = await this.app.vault.readBinary(
              currentItem.file,
            );
            imageData = await decodeImage(arrayBuffer);
          } else {
            let arrayBuffer: ArrayBuffer;
            if (currentItem.url.startsWith('http')) {
              const response = await requestUrl({ url: currentItem.url });
              arrayBuffer = response.arrayBuffer;
            } else {
              const response = await fetch(currentItem.url);
              if (!response.ok) {
                throw new Error(
                  `Failed to load image: ${response.status} ${response.statusText}`,
                );
              }
              arrayBuffer = await response.arrayBuffer();
            }
            imageData = await decodeImage(arrayBuffer);
          }

          // Allow UI update
          await new Promise((r) => setTimeout(r, 50));

          const results = await this.ocrEngine.detect(imageData);
          store.updateItem(currentItem.id, {
            status: 'success',
            ocrResults: results,
          });
          processedCount++;
        } catch (e) {
          console.error(e);
          store.updateItem(currentItem.id, {
            status: 'error',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    if (processedCount > 0) {
      // Save results to cache for this file
      const finalStore = useAnalysisStore.getState();
      if (finalStore.sourceId) {
        finalStore.saveToCache(finalStore.sourceId, finalStore.items);
      }
      new Notice(`Text recognition complete (${processedCount} images)`);
    }
  }

  async analyzeImageUrl(url: string, options?: { auto?: boolean }) {
    const shouldOpen = !options?.auto || this.settings.autoOpenPanel;
    if (shouldOpen) await this.activateView();
    const store = useAnalysisStore.getState();

    const item: AnalysisItem = {
      id: url,
      file: null,
      url: url,
      status: 'pending',
      ocrResults: null,
      error: null,
    };

    store.setItems([item]);
    await this.processQueue();
  }

  async analyzeFile(file: TFile, options?: { auto?: boolean }) {
    const shouldOpen = !options?.auto || this.settings.autoOpenPanel;
    if (shouldOpen) await this.activateView();
    const store = useAnalysisStore.getState();

    // Check Cache
    if (store.loadFromCache(file.path)) {
      new Notice('Loaded recognition results from cache');
      return;
    }

    const resourcePath = this.app.vault.getResourcePath(file);
    const item: AnalysisItem = {
      id: file.path,
      file: file,
      url: resourcePath,
      status: 'pending',
      ocrResults: null,
      error: null,
    };

    store.setItems([item]);
    await this.processQueue();
  }

  async analyzeNote(noteFile: TFile, options?: { auto?: boolean }) {
    const shouldOpen = !options?.auto || this.settings.autoOpenPanel;
    if (shouldOpen) await this.activateView();
    const store = useAnalysisStore.getState();

    // Check Cache
    if (store.loadFromCache(noteFile.path)) {
      new Notice('Loaded recognition results from cache');
      return;
    }

    const cache = this.app.metadataCache.getFileCache(noteFile);

    const items: AnalysisItem[] = [];
    const seenIds = new Set<string>();

    // 1. Process Internal Embeds
    if (cache && cache.embeds) {
      for (const embed of cache.embeds) {
        const file = this.app.metadataCache.getFirstLinkpathDest(
          embed.link,
          noteFile.path,
        );
        if (
          file &&
          ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(
            file.extension.toLowerCase(),
          )
        ) {
          if (!seenIds.has(file.path)) {
            seenIds.add(file.path);
            items.push({
              id: file.path,
              file: file,
              url: this.app.vault.getResourcePath(file),
              status: 'pending',
              ocrResults: null,
              error: null,
            });
          }
        }
      }
    }

    // 2. Process External Images (Regex scan)
    const content = await this.app.vault.read(noteFile);
    const externalImgRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = externalImgRegex.exec(content)) !== null) {
      const url = match[1];
      if (!seenIds.has(url)) {
        seenIds.add(url);
        items.push({
          id: url,
          file: null,
          url: url,
          status: 'pending',
          ocrResults: null,
          error: null,
        });
      }
    }

    if (items.length === 0) {
      new Notice('No images found in this note.');
      return;
    }

    store.setItems(items);
    await this.processQueue();
    new Notice(`Queued ${items.length} images for analysis.`);
  }

  async analyzeText(text: string, sourceFile: TFile) {
    const items: AnalysisItem[] = [];
    const seenIds = new Set<string>();

    // WikiLinks: ![[filename.png|alias]]
    const wikiRegex = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = wikiRegex.exec(text)) !== null) {
      const linktext = match[1];
      const file = this.app.metadataCache.getFirstLinkpathDest(
        linktext,
        sourceFile.path,
      );
      if (
        file &&
        ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(
          file.extension.toLowerCase(),
        )
      ) {
        if (!seenIds.has(file.path)) {
          seenIds.add(file.path);
          items.push({
            id: file.path,
            file: file,
            url: this.app.vault.getResourcePath(file),
            status: 'pending',
            ocrResults: null,
            error: null,
          });
        }
      }
    }

    // MD Links: ![](path)
    const mdRegex = /!\[.*?\]\((https?:\/\/[^)]+|[^)]+)\)/g;
    while ((match = mdRegex.exec(text)) !== null) {
      const link = match[1];
      if (link.startsWith('http')) {
        if (!seenIds.has(link)) {
          seenIds.add(link);
          items.push({
            id: link,
            file: null,
            url: link,
            status: 'pending',
            ocrResults: null,
            error: null,
          });
        }
      } else {
        // Local MD link
        const file = this.app.metadataCache.getFirstLinkpathDest(
          decodeURIComponent(link),
          sourceFile.path,
        );
        if (
          file &&
          ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(
            file.extension.toLowerCase(),
          )
        ) {
          if (!seenIds.has(file.path)) {
            seenIds.add(file.path);
            items.push({
              id: file.path,
              file: file,
              url: this.app.vault.getResourcePath(file),
              status: 'pending',
              ocrResults: null,
              error: null,
            });
          }
        }
      }
    }

    if (items.length > 0) {
      const store = useAnalysisStore.getState();
      store.setItems(items);
      await this.processQueue();
      await this.activateView();
      new Notice(`Queued ${items.length} images from selection.`);
    } else {
      new Notice('No valid images found in selection.');
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    await this.applySettings();
  }

  async applySettings() {
    if (this.ocrEngine) {
      await this.ocrEngine.setThreshold(this.settings.textConfidenceThreshold);
    }
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_ANALYSIS);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf)
        await leaf.setViewState({ type: VIEW_TYPE_ANALYSIS, active: true });
    }

    if (leaf) workspace.revealLeaf(leaf);
  }

  onunload() {
    // Cleanup if needed
  }
}
