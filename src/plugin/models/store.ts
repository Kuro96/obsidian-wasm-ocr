import { create } from 'zustand';
import type { TFile } from 'obsidian';
import { OcrResultItem } from '../services/OcrEngine';

export interface SelectionAnchor {
  boxIndex: number;
  charIndex: number;
}

export interface AnalysisItem {
  id: string;
  file: TFile;
  url: string;
  status: 'pending' | 'analyzing' | 'success' | 'error';
  ocrResults: OcrResultItem[] | null;
  error: string | null;
}

interface AnalysisState {
  items: AnalysisItem[];
  currentIndex: number;

  // Selection state for the CURRENT item
  selectedIndices: number[];
  activeRange: { start: SelectionAnchor; end: SelectionAnchor } | null;
  mergeLines: boolean;

  // Caching
  resultsCache: Map<string, AnalysisItem[]>;
  sourceId: string | null;

  setItems: (items: AnalysisItem[]) => void;
  setCurrentIndex: (index: number) => void;
  updateItem: (id: string, updates: Partial<AnalysisItem>) => void;

  toggleSelection: (index: number, multi: boolean) => void;
  setSelection: (indices: number[]) => void;
  setActiveRange: (
    range: { start: SelectionAnchor; end: SelectionAnchor } | null,
  ) => void;
  clearSelection: () => void;
  setMergeLines: (merge: boolean) => void;

  setSourceId: (id: string | null) => void;
  saveToCache: (sourceId: string, items: AnalysisItem[]) => void;
  loadFromCache: (sourceId: string) => boolean;

  nextImage: () => void;
  prevImage: () => void;
  reset: () => void;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  items: [],
  currentIndex: 0,
  selectedIndices: [],
  activeRange: null,
  mergeLines: false,
  resultsCache: new Map(),
  sourceId: null,

  setItems: (items) =>
    set({
      items,
      currentIndex: 0,
      selectedIndices: [],
      activeRange: null,
    }),

  setCurrentIndex: (index) => {
    const { items } = get();
    if (index >= 0 && index < items.length) {
      set({
        currentIndex: index,
        selectedIndices: [],
        activeRange: null,
      });
    }
  },

  updateItem: (id, updates) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item,
      ),
    })),

  toggleSelection: (index, multi) =>
    set((state) => {
      const current = state.selectedIndices;
      let newIndices;
      if (!multi) {
        newIndices = [index];
      } else {
        if (current.includes(index)) {
          newIndices = current.filter((i) => i !== index);
        } else {
          newIndices = [...current, index];
        }
      }
      return { selectedIndices: newIndices, activeRange: null };
    }),

  setSelection: (indices) =>
    set({ selectedIndices: indices, activeRange: null }),

  setActiveRange: (range) => set({ activeRange: range, selectedIndices: [] }),

  clearSelection: () => set({ selectedIndices: [], activeRange: null }),

  setMergeLines: (merge) => set({ mergeLines: merge }),

  setSourceId: (id) => set({ sourceId: id }),

  saveToCache: (sourceId, items) =>
    set((state) => {
      const newCache = new Map(state.resultsCache);
      // Remove if exists to update position (LRU behavior for Map iteration)
      if (newCache.has(sourceId)) newCache.delete(sourceId);
      newCache.set(sourceId, items);

      // Limit size
      if (newCache.size > 5) {
        const firstKey = newCache.keys().next().value;
        if (firstKey) newCache.delete(firstKey);
      }
      return { resultsCache: newCache };
    }),

  loadFromCache: (sourceId) => {
    const { resultsCache } = get();
    if (resultsCache.has(sourceId)) {
      set({
        items: resultsCache.get(sourceId),
        sourceId: sourceId,
        currentIndex: 0,
        selectedIndices: [],
        activeRange: null,
      });
      return true;
    }
    return false;
  },

  nextImage: () => {
    const { items, currentIndex } = get();
    if (currentIndex < items.length - 1) {
      set({
        currentIndex: currentIndex + 1,
        selectedIndices: [],
        activeRange: null,
      });
    }
  },

  prevImage: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) {
      set({
        currentIndex: currentIndex - 1,
        selectedIndices: [],
        activeRange: null,
      });
    }
  },

  reset: () =>
    set({
      items: [],
      currentIndex: 0,
      selectedIndices: [],
      activeRange: null,
    }),
}));
