import React from 'react';
import { useAnalysisStore } from '../models/store';
import { Trash2 } from 'lucide-react';

export const Header: React.FC = () => {
  const { items, currentIndex, reset } = useAnalysisStore();
  const currentItem = items[currentIndex];

  if (!currentItem) return <div className="nav-header"></div>;

  let name = 'Web Image';
  if (currentItem.file) {
    name = currentItem.file.name;
  } else if (currentItem.url.startsWith('blob:')) {
    name = 'Clipboard Image';
  }

  return (
    <div className="nav-header">
      <div
        style={{
          padding: '0 10px 10px 10px',
          fontSize: '0.8em',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '70%',
          }}
          title={name}
        >
          📷 {name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {items.length > 1 && (
            <span>
              {currentIndex + 1} / {items.length}
            </span>
          )}
          <div
            onClick={reset}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              color: 'var(--text-muted)',
            }}
            title="Clear Results"
          >
            <Trash2 size={14} />
          </div>
        </div>
      </div>
    </div>
  );
};
