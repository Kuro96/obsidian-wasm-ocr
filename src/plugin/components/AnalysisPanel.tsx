import React, { useState, useRef, useEffect } from 'react';
import { Header } from './Header';
import { ImagePreview } from './ImagePreview';
import { ResultList } from './ResultList';

export const AnalysisPanel: React.FC = () => {
  const [resultsHeight, setResultsHeight] = useState(250);
  const containerRef = useRef<HTMLDivElement>(null);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
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
        style={{
          height: '6px',
          cursor: 'ns-resize',
          backgroundColor: 'var(--background-modifier-border)',
          flexShrink: 0,
          transition: 'background-color 0.2s',
          zIndex: 10,
        }}
        className="resize-handle"
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = 'var(--interactive-accent)')
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor =
            'var(--background-modifier-border)')
        }
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
