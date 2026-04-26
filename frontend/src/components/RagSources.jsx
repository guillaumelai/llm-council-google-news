import { useState } from 'react';
import './RagSources.css';

const SOURCE_COLORS = {
  rss:    { bg: '#fff3e0', text: '#e65c00' },
  url:    { bg: '#e8f5e9', text: '#2e7d32' },
  file:   { bg: '#f3e5f5', text: '#7b1fa2' },
  manual: { bg: '#e3f2fd', text: '#1565c0' },
};

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

export default function RagSources({ sources }) {
  const [open, setOpen] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="rag-sources">
      <button className="rag-sources-header" onClick={() => setOpen(o => !o)}>
        <div className="rag-sources-header-left">
          <span className="rag-sources-icon">⬡</span>
          <span className="rag-sources-label">
            Knowledge Base context injected into all models
          </span>
          <span className="rag-sources-count">{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
        </div>
        <span className="rag-sources-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <ul className="rag-sources-list">
          {sources.map((src, i) => {
            const colors = SOURCE_COLORS[src.source_type] || { bg: '#f5f5f5', text: '#555' };
            const isExpanded = expandedIdx === i;
            const pubDate = formatDate(src.published_date);
            return (
              <li key={i} className="rag-source-item">
                <div className="rag-source-top">
                  <span
                    className="rag-source-badge"
                    style={{ background: colors.bg, color: colors.text }}
                  >
                    {src.source_type || 'doc'}
                  </span>
                  <span className="rag-source-title">{src.title}</span>
                  {src.source_url && (
                    <a
                      className="rag-source-url"
                      href={src.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ↗
                    </a>
                  )}
                </div>
                <div className="rag-source-meta">
                  {src.source_outlet && (
                    <span className="rag-source-outlet">{src.source_outlet}</span>
                  )}
                  {pubDate && (
                    <span className="rag-source-date">{pubDate}</span>
                  )}
                  {src.keywords_matched && (
                    <span className="rag-source-keywords" title="Keywords matched">
                      🔑 {src.keywords_matched}
                    </span>
                  )}
                </div>
                {src.summary && (
                  <div className="rag-source-summary">{src.summary}</div>
                )}
                {src.excerpt && !src.summary && (
                  <>
                    <button
                      className="rag-source-expand"
                      onClick={() => setExpandedIdx(isExpanded ? null : i)}
                    >
                      {isExpanded ? 'Hide excerpt' : 'Show excerpt'}
                    </button>
                    {isExpanded && (
                      <div className="rag-source-excerpt">{src.excerpt}</div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
