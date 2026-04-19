import { useState } from 'react';
import './RagSources.css';

const TYPE_COLORS = {
  rss: '#1a73e8',
  url: '#7b1fa2',
  file: '#e65100',
  manual: '#2e7d32',
};

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export default function RagSources({ sources }) {
  const [open, setOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="rag-sources">
      <button className="rag-sources-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▼' : '▶'} Sources ({sources.length})
      </button>
      {open && (
        <ul className="rag-sources-list">
          {sources.map((src, i) => (
            <li key={i} className="rag-source-item">
              <span
                className="rag-source-badge"
                style={{ background: TYPE_COLORS[src.source_type] || '#888' }}
              >
                {src.source_type}
              </span>
              <span className="rag-source-title">{src.title}</span>
              {src.source_url && (
                <a
                  className="rag-source-url"
                  href={src.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={src.source_url}
                >
                  {truncate(src.source_url, 60)}
                </a>
              )}
              {src.excerpt && (
                <span className="rag-source-excerpt">{src.excerpt}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
