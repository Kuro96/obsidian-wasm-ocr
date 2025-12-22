import React, { useState, useRef, useEffect } from 'react';
import { Header } from './Header';
import { ImagePreview } from './ImagePreview';
import { ResultList } from './ResultList';

export const AnalysisPanel: React.FC = () => {
  const [resultsHeight, setResultsHeight] = useState(250);
  const containerRef = useRef<HTMLDivElement>(null);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    document.body.style.cursor = 'ns-resize';

    const resize = (e: MouseEvent) => {
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        // Calculate new height relative to container bottom
        // New Height = Container Bottom - Mouse Y
        const newHeight = containerRect.bottom - e.clientY;

        // Clamp height
        const minHeight = 100;
        const maxHeight = containerRect.height - 100; // Leave space for image
        setResultsHeight(Math.max(minHeight, Math.min(maxHeight, newHeight)));
      }
    };

    const stopResizing = () => {
      // eslint-disable-next-line obsidianmd/no-static-styles-assignment
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };

    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
  };

  return (
    <div
      ref={containerRef}
      className="analysis-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--background-primary)',
        overflow: 'hidden', // Prevent scrollbar on main container
      }}
    >
      <Header />

      {/* Top Pane: Image Preview */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <ImagePreview />
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={startResizing}
        className="resize-handle ocr-resize-handle"
      />

      {/* Bottom Pane: Results */}
      <div
        style={{
          height: `${resultsHeight}px`,
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <ResultList />
      </div>
    </div>
  );
};
