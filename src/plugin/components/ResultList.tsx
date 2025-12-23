import React, { useMemo } from 'react';
import { useAnalysisStore } from '../models/store';
import { OcrResultItem } from '../services/OcrEngine';
import {
  Copy,
  Loader,
  HelpCircle,
} from 'lucide-react';
import { Notice } from 'obsidian';

// Helper: Sort and Merge
function processResults(
  results: OcrResultItem[],
  merge: boolean,
  disableSort = false,
): string {
  if (!results.length) return '';

  let sorted = [...results];

  if (!disableSort) {
    // 1. Robust Sort (Y-banding then X)
    let totalH = 0;
    results.forEach((r) => {
      const ys = r.box.map((p) => p[1]);
      totalH += Math.max(...ys) - Math.min(...ys);
    });
    const avgH = totalH / results.length;
    const threshold = avgH * 0.5;

    sorted.sort((a, b) => {
      const aCy = (a.box[0][1] + a.box[2][1]) / 2;
      const bCy = (b.box[0][1] + b.box[2][1]) / 2;

      if (Math.abs(aCy - bCy) < threshold) {
        const aCx = Math.min(...a.box.map((p) => p[0]));
        const bCx = Math.min(...b.box.map((p) => p[0]));
        return aCx - bCx;
      }
      return aCy - bCy;
    });
  }

  if (!merge) {
    return sorted.map((r) => r.text).join('\n');
  }

  // 2. Smart Merge
  let text = '';
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    if (i === 0) {
      text += curr.text;
      continue;
    }

    const prev = sorted[i - 1];

    // Heuristics
    const isStop = /[.!?。！？：:]\s*$/.test(prev.text);
    const isList = /^[-*•]\s/.test(curr.text) || /^\d+\.\s/.test(curr.text);

    let isGap = false;
    if (!disableSort) {
      const prevBottom = Math.max(...prev.box.map((p) => p[1]));
      const currTop = Math.min(...curr.box.map((p) => p[1]));
      const h =
        (prev.box[2][1] - prev.box[0][1] + curr.box[2][1] - curr.box[0][1]) / 2;
      isGap = currTop - prevBottom > h * 1.5;
    }

    if (isStop || isList || isGap) {
      text += '\n' + curr.text;
    } else {
      const prevLast = prev.text[prev.text.length - 1];
      const currFirst = curr.text[0];
      const isCJK = (c: string) => /[一-龥]/.test(c);

      if (prevLast && currFirst && isCJK(prevLast) && isCJK(currFirst)) {
        text += curr.text;
      } else {
        if (prevLast === '-') {
          text = text.slice(0, -1) + curr.text;
        } else {
          text += ' ' + curr.text;
        }
      }
    }
  }
  return text;
}

export const ResultList: React.FC = () => {
  const {
    items,
    currentIndex,
    selectedIndices,
    activeRange,
    mergeLines,
    setMergeLines,
  } = useAnalysisStore();

  const currentItem = items[currentIndex];
  const ocrResults = currentItem?.ocrResults;

  // 1. Calculate Selection State (Subset of data)
  const selectionData = useMemo(() => {
    if (!ocrResults) return null;

    if (activeRange) {
      // Range Selection
      let { start, end } = activeRange;
      if (
        start.boxIndex > end.boxIndex ||
        (start.boxIndex === end.boxIndex && start.charIndex > end.charIndex)
      ) {
        [start, end] = [end, start];
      }

      const subset = [];
      for (let i = start.boxIndex; i <= end.boxIndex; i++) {
        subset.push(ocrResults[i]);
      }

      return { type: 'range' as const, subset, start, end };
    } else if (selectedIndices.length > 0) {
      // Box Selection (Manual Order)
      const subset = selectedIndices.map((i) => ocrResults[i]);
      return { type: 'box' as const, subset };
    } else {
      // No Selection
      return { type: 'all' as const, subset: ocrResults };
    }
  }, [ocrResults, selectedIndices, activeRange]);

  // 2. Compute Display Text (Merged or List)
  const mergedViewText = useMemo(() => {
    if (!selectionData) return '';

    let itemsToProcess = selectionData.subset;

    // For Range selection + Merge, we need to trim the text of the start/end blocks
    if (selectionData.type === 'range') {
      itemsToProcess = itemsToProcess.map((item, idx) => {
        let text = item.text;
        const isFirst = idx === 0;
        const isLast = idx === itemsToProcess.length - 1;

        const startChar = isFirst ? selectionData.start.charIndex : 0;
        const endChar = isLast ? selectionData.end.charIndex : text.length - 1;

        // Handle single-box range
        if (isFirst && isLast) {
          return { ...item, text: text.substring(startChar, endChar + 1) };
        }

        if (isFirst) text = text.substring(startChar);
        if (isLast) text = text.substring(0, endChar + 1);

        return { ...item, text };
      });
    }

    // Disable sort if it's a Box selection (User Click Order)
    // Enable sort if Range or All (Geometric)
    const disableSort = selectionData.type === 'box';

    return processResults(itemsToProcess, true, disableSort);
  }, [selectionData]);

  if (!currentItem) return null;

  const { status, error } = currentItem;

  if (status === 'analyzing' || status === 'pending')
    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        <Loader className="animate-spin" style={{ margin: '0 auto 10px' }} />
        <div>{status === 'pending' ? 'Pending...' : 'Running OCR...'}</div>
      </div>
    );

  if (error)
    return (
      <div
        style={{
          padding: '20px',
          color: 'var(--color-red)',
          border: '1px solid var(--color-red)',
          margin: '10px',
          borderRadius: '4px',
        }}
      >
        <strong>Error:</strong> {error}
      </div>
    );

  if (!ocrResults || !selectionData) return null;

  const handleCopy = async () => {
    if (mergeLines) {
      await navigator.clipboard.writeText(mergedViewText);
      new Notice(
        selectionData.type !== 'all'
          ? 'Copied merged selection'
          : 'Copied merged text',
      );
    } else {
      // If Merge OFF, we copy the "List View" text.
      let text = '';
      if (selectionData.type === 'range') {
        const { start, end, subset } = selectionData;
        text = subset
          .map((item, idx) => {
            let str = item.text;
            const isFirst = idx === 0;
            const isLast = idx === subset.length - 1;
            const s = isFirst ? start.charIndex : 0;
            const e = isLast ? end.charIndex : str.length - 1;
            return str.substring(s, e + 1);
          })
          .join(' ');
      } else {
        text = selectionData.subset.map((r) => r.text).join('\n');
      }

      if (text) {
        await navigator.clipboard.writeText(text);
        new Notice('Copied text');
      }
    }
  };

  // Render logic for List View (Merge OFF)
  const renderListView = () => {
    const { subset, type } = selectionData;

    return subset.map((item, idx) => {
      let content = item.text;
      let before = '';
      let highlighted = '';
      let after = '';

      if (type === 'range') {
        const { start, end } = selectionData;
        // Map local idx to subset bounds
        const isFirst = idx === 0;
        const isLast = idx === subset.length - 1;

        const s = isFirst ? start.charIndex : 0;
        const e = isLast ? end.charIndex : item.text.length - 1;

        before = item.text.substring(0, s);
        highlighted = item.text.substring(s, e + 1);
        after = item.text.substring(e + 1);
      } else if (type === 'box') {
        highlighted = item.text;
      } else {
        // type === 'all'
        before = item.text;
      }

      return (
        <div key={idx} style={{ marginBottom: '4px' }}>
          <span>{before}</span>
          {highlighted && (
            <span
              style={{
                backgroundColor:
                  type !== 'all'
                    ? 'rgba(var(--interactive-accent-rgb), 0.7)'
                    : 'transparent',
              }}
            >
              {highlighted}
            </span>
          )}
          <span>{after}</span>
        </div>
      );
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderTop: '1px solid var(--background-modifier-border)',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          padding: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--background-secondary)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold' }}>OCR Text</span>
          <span
            style={{
              fontSize: '0.8em',
              color: 'var(--text-muted)',
              marginLeft: '8px',
            }}
          >
            {selectionData.type !== 'all'
              ? `${selectionData.subset.length}/${ocrResults.length}`
              : `${ocrResults.length}`}{' '}
            blocks
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Selection Help */}
          <div
            style={{
              color: 'var(--text-muted)',
              cursor: 'help',
              display: 'flex',
            }}
            title={`Selection Modes:
• Drag: Select text range
• Ctrl/Cmd + Drag: Add to Box Selection
• Shift + Drag: Remove from Box Selection
• Ctrl/Cmd + Click: Toggle box selection
• Click Empty: Clear selection`}
          >
            <HelpCircle size={14} />
          </div>

          {/* Toggle Merge Switch */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 6px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8em',
              userSelect: 'none',
              color: 'var(--text-muted)',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setMergeLines(!mergeLines);
            }}
            title="Merge broken lines into paragraphs"
          >
            <span>Merge Lines</span>
            <div
              style={{
                width: '32px',
                height: '18px',
                borderRadius: '10px',
                backgroundColor: mergeLines
                  ? 'var(--interactive-accent)'
                  : 'var(--background-modifier-border)',
                position: 'relative',
                transition: 'background-color 0.2s',
              }}
            >
              <div
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: 'white',
                  position: 'absolute',
                  top: '2px',
                  left: mergeLines ? '16px' : '2px',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px',
          background: 'var(--background-primary)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-monospace)',
            fontSize: '0.85em',
            marginBottom: '10px',
            userSelect: 'text',
          }}
        >
          {mergeLines ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{mergedViewText}</div>
          ) : (
            renderListView()
          )}
        </div>
      </div>

      {/* Footer / Copy Button */}
      <div
        style={{
          padding: '8px',
          borderTop: '1px solid var(--background-modifier-border)',
          background: 'var(--background-secondary)',
          flexShrink: 0,
        }}
      >
        <button
          className="mod-cta"
          onClick={handleCopy}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Copy size={14} />
          {mergeLines
            ? selectionData.type !== 'all'
              ? 'Copy Merged Selected'
              : 'Copy Merged'
            : selectionData.type !== 'all'
              ? 'Copy Selected'
              : 'Copy All'}
        </button>
      </div>
    </div>
  );
};
