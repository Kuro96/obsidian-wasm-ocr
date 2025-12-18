import React from 'react';
import { useAnalysisStore } from '../models/store';

export const Header: React.FC = () => {
  const { items, currentIndex } = useAnalysisStore();
  const currentItem = items[currentIndex];

  if (!currentItem) return <div className="nav-header"></div>;

  const name = currentItem.file ? currentItem.file.name : 'Web Image';

  return (
    <div className="nav-header">
      <div
        style={{
          padding: '0 10px 10px 10px',
          fontSize: '0.8em',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <div>📷 {name}</div>
        {items.length > 1 && (
          <div>
            {currentIndex + 1} / {items.length}
          </div>
        )}
      </div>
    </div>
  );
};
