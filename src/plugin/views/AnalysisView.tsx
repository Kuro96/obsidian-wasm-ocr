import { ItemView, WorkspaceLeaf } from 'obsidian';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { AnalysisPanel } from '../components/AnalysisPanel';

export const VIEW_TYPE_ANALYSIS = 'analysis-view';

export class AnalysisView extends ItemView {
  root: Root | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_ANALYSIS;
  }

  getDisplayText() {
    return 'Image analysis';
  }

  getIcon() {
    return 'scan-search';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    this.root = createRoot(container);
    this.root.render(
      <React.StrictMode>
        <AnalysisPanel />
      </React.StrictMode>,
    );
  }

  async onClose() {
    if (this.root) {
      this.root.unmount();
    }
  }
}
