import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../api';
import './KnowledgeBase.css';

export default function KnowledgeBase() {
  const [activeTab, setActiveTab] = useState('documents');
  const [logFeedFilter, setLogFeedFilter] = useState(null); // { url, name } | null
  const [docCount, setDocCount] = useState(null);

  const refreshStats = useCallback(async () => {
    try {
      const docs = await api.listDocuments();
      setDocCount(docs.length);
    } catch (_) {
      // stats are best-effort
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const handleViewFeedLog = useCallback((feed) => {
    // For Google News searches, filter by the RSS URL they log under
    const logUrl = feed.rss_url || feed.url;
    setLogFeedFilter({ url: logUrl, name: feed.name || feed.url });
    setActiveTab('log');
  }, []);

  const handleTabChange = (key) => {
    setActiveTab(key);
    if (key !== 'log') setLogFeedFilter(null);
  };

  return (
    <div className="kb-page">
      <div className="kb-header">
        <h2 className="kb-title">Knowledge Base</h2>
        <div className="kb-stats">
          {docCount !== null && <span>{docCount} doc{docCount !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      <div className="kb-tabs">
        {[
          { key: 'documents', label: 'Documents' },
          { key: 'google-news', label: 'Google News' },
          { key: 'log', label: 'Activity Log' },
          { key: 'graph-db', label: 'Graph DB' },
          { key: 'vector-index', label: 'Vector Index' },
          { key: 'stats', label: 'Stats' },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={`kb-tab ${activeTab === key ? 'active' : ''}`}
            onClick={() => handleTabChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="kb-tab-content">
        {activeTab === 'documents' && (
          <DocumentsTab
            onDocChange={refreshStats}
          />
        )}
        {activeTab === 'google-news' && (
          <GoogleNewsTab onViewLog={handleViewFeedLog} />
        )}
        {activeTab === 'graph-db' && <GraphDBTab />}
        {activeTab === 'vector-index' && <VectorIndexTab />}
        {activeTab === 'stats' && <StatsTab />}
        {activeTab === 'log' && (
          <ActivityLogTab
            feedFilter={logFeedFilter}
            onClearFilter={() => setLogFeedFilter(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Documents Tab ────────────────────────────────────────────────────────────

const SOURCE_TYPES = ['rss', 'url', 'file', 'manual'];
const SOURCE_LABELS = { rss: 'RSS', url: 'URL', file: 'File', manual: 'Manual' };

const TIME_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function filterByTime(docs, range) {
  if (range === 'all') return docs;
  const now = Date.now();
  const ms = range === '24h' ? 86400000 : range === '7d' ? 7 * 86400000 : 30 * 86400000;
  return docs.filter((d) => d.created_at && now - new Date(d.created_at).getTime() <= ms);
}

function DocumentsTab({ onDocChange }) {
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterTime, setFilterTime] = useState('all');
  const [filterFeed, setFilterFeed] = useState('all');
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [selectedDocDetail, setSelectedDocDetail] = useState(null);
  const [detailSubTab, setDetailSubTab] = useState('preview');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listDocuments();
      setDocuments(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleSelectDoc = async (doc) => {
    setSelectedDoc(doc);
    setDetailLoading(true);
    setSelectedDocDetail(null);
    setDetailSubTab('preview');
    try {
      const full = await api.getDocument(doc.doc_id);
      setSelectedDocDetail(full);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (e, doc) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    try {
      await api.deleteDocument(doc.doc_id);
      if (selectedDoc?.doc_id === doc.doc_id) {
        setSelectedDoc(null);
        setSelectedDocDetail(null);
      }
      await loadDocuments();
      onDocChange?.();
    } catch (e) {
      setError(e.message);
    }
  };

  // Count by type for badge counts
  const countByType = documents.reduce((acc, d) => {
    const t = d.source_type || 'manual';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  // Unique feed names (non-empty) for the feed filter dropdown
  const feedNames = [...new Set(
    documents.map((d) => d.feed_name).filter(Boolean)
  )].sort();

  const filtered = filterByTime(
    documents.filter((d) => {
      const matchesSearch = d.title.toLowerCase().includes(search.toLowerCase());
      const matchesType = filterType === 'all' || (d.source_type || 'manual') === filterType;
      const matchesFeed = filterFeed === 'all' || d.feed_name === filterFeed;
      return matchesSearch && matchesType && matchesFeed;
    }),
    filterTime
  );

  return (
    <div className="kb-split">
      {/* Left: document list */}
      <div className="kb-list-panel">
        {error && <div className="kb-error" style={{ margin: '12px' }}>{error}</div>}
        <div className="kb-list-search-wrap">
          <input
            className="kb-search"
            type="text"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Source type filter */}
        <div className="kb-doc-filters">
          <div className="kb-filter-row">
            <button
              className={`kb-filter-pill ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              All
              <span className="kb-filter-pill-count">{documents.length}</span>
            </button>
            {SOURCE_TYPES.filter((t) => countByType[t] > 0).map((t) => (
              <button
                key={t}
                className={`kb-filter-pill kb-filter-pill-${t} ${filterType === t ? 'active' : ''}`}
                onClick={() => setFilterType(filterType === t ? 'all' : t)}
              >
                {SOURCE_LABELS[t]}
                <span className="kb-filter-pill-count">{countByType[t]}</span>
              </button>
            ))}
          </div>
          <div className="kb-filter-selects">
            {feedNames.length > 0 && (
              <select
                className="kb-time-select"
                value={filterFeed}
                onChange={(e) => setFilterFeed(e.target.value)}
                title="Filter by source feed"
              >
                <option value="all">All sources</option>
                {feedNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            )}
            <select
              className="kb-time-select"
              value={filterTime}
              onChange={(e) => setFilterTime(e.target.value)}
            >
              {TIME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="kb-doc-count">
          {filtered.length} of {documents.length} document{documents.length !== 1 ? 's' : ''}
        </div>

        {loading ? (
          <div className="kb-loading">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="kb-empty">
            {documents.length === 0 ? (
              'No documents yet.'
            ) : (
              'No documents match your filters.'
            )}
          </div>
        ) : (
          <div className="kb-doc-list">
            {filtered.map((doc) => (
              <div
                key={doc.doc_id}
                className={`kb-doc-row ${selectedDoc?.doc_id === doc.doc_id ? 'selected' : ''}`}
                onClick={() => handleSelectDoc(doc)}
              >
                <div className="kb-doc-info">
                  <span className="kb-doc-title">{doc.title}</span>
                  <div className="kb-doc-meta">
                    <SourceBadge type={doc.source_type} />
                    {doc.feed_name && (
                      <span
                        className="kb-doc-feed"
                        title={doc.feed_name}
                        onClick={(e) => { e.stopPropagation(); setFilterFeed(doc.feed_name); }}
                      >
                        {doc.feed_name}
                      </span>
                    )}
                    <span className="kb-doc-date">{formatDate(doc.created_at)}</span>
                    {doc.chunk_count != null && (
                      <span className="kb-doc-chunks">{doc.chunk_count} chunks</span>
                    )}
                  </div>
                </div>
                <button
                  className="kb-delete-btn"
                  onClick={(e) => handleDelete(e, doc)}
                  title="Delete document"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: document detail */}
      <div className="kb-detail-panel">
        {!selectedDoc ? (
          <div className="kb-detail-empty">Select a document to preview</div>
        ) : detailLoading ? (
          <div className="kb-loading">Loading document...</div>
        ) : selectedDocDetail ? (
          <>
            <div className="kb-detail-header">
              <h3 className="kb-detail-title">{selectedDocDetail.title}</h3>
              <div className="kb-detail-meta-row">
                <SourceBadge type={selectedDocDetail.source_type} />
                {selectedDocDetail.feed_name && (
                  <span className="kb-doc-feed kb-doc-feed-detail">{selectedDocDetail.feed_name}</span>
                )}
                <span className="kb-doc-date">{formatDate(selectedDocDetail.created_at)}</span>
                {selectedDocDetail.source_url && (
                  <a
                    href={selectedDocDetail.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="kb-detail-url"
                  >
                    {selectedDocDetail.source_url}
                  </a>
                )}
              </div>
            </div>

            <div className="kb-subtabs">
              {['preview', 'raw', 'vectors'].map((t) => (
                <button
                  key={t}
                  className={`kb-subtab ${detailSubTab === t ? 'active' : ''}`}
                  onClick={() => setDetailSubTab(t)}
                >
                  {t === 'preview' ? 'Preview' : t === 'raw' ? 'Raw Text' : 'Vectors'}
                </button>
              ))}
            </div>

            {detailSubTab === 'preview' && (
              <div className="kb-detail-preview">
                {(selectedDocDetail.chunks || []).map((chunk, i) => (
                  <div key={chunk.id || i} className="kb-chunk">
                    <div className="kb-chunk-label">Chunk {i + 1}</div>
                    <div className="kb-chunk-text">{chunk.text || chunk}</div>
                  </div>
                ))}
              </div>
            )}

            {detailSubTab === 'raw' && (
              <div className="kb-detail-raw">
                {(selectedDocDetail.chunks || []).map((chunk, i) => (
                  <div key={chunk.id || i} className="kb-raw-block">
                    <div className="kb-raw-label">#{i + 1}</div>
                    <pre className="kb-raw-text">{chunk.text || chunk}</pre>
                  </div>
                ))}
              </div>
            )}

            {detailSubTab === 'vectors' && (
              <div className="kb-detail-vectors">
                <div className="kb-vec-model-row">
                  <span className="kb-vec-model-label">Embedding model</span>
                  <span className="kb-vec-model-value">{selectedDocDetail.embedding_model}</span>
                  <span className="kb-vec-dim-pill">{selectedDocDetail.embedding_dimensions}d</span>
                  <span className="kb-vec-chunk-count">{selectedDocDetail.chunk_count} chunk{selectedDocDetail.chunk_count !== 1 ? 's' : ''}</span>
                </div>
                {(selectedDocDetail.chunks || []).map((chunk, i) => (
                  <div key={chunk.id || i} className="kb-vec-chunk">
                    <div className="kb-vec-chunk-header">
                      <span className="kb-vec-chunk-index">Chunk {i + 1}</span>
                      <span className="kb-vec-chunk-id" title={chunk.id}>{chunk.id}</span>
                    </div>
                    <div className="kb-vec-meta-grid">
                      {Object.entries(chunk.metadata || {}).map(([k, v]) => (
                        <div key={k} className="kb-vec-meta-row">
                          <span className="kb-vec-meta-key">{k}</span>
                          <span className="kb-vec-meta-val">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                    {chunk.embedding_preview && (
                      <div className="kb-vec-embedding">
                        <span className="kb-vec-embedding-label">Vector preview (first 8 of {chunk.embedding_dimensions})</span>
                        <span className="kb-vec-embedding-values">
                          [{chunk.embedding_preview.map(v => v.toFixed(4)).join(', ')}, …]
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function SourceBadge({ type }) {
  const label = type || 'manual';
  return <span className={`kb-badge kb-badge-${label}`}>{label}</span>;
}


// ─── Google News Tab ──────────────────────────────────────────────────────────

function GoogleNewsTab({ onViewLog }) {
  const [searches, setSearches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshingId, setRefreshingId] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editState, setEditState] = useState({});

  // Add form state
  const [newKeywords, setNewKeywords] = useState('');
  const [newName, setNewName] = useState('');
  const [newInterval, setNewInterval] = useState(24);
  const [newLookback, setNewLookback] = useState(1);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState(null);

  const loadSearches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSearches(await api.listGoogleNewsSearches());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSearches(); }, [loadSearches]);

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    setError(null);
    try {
      for (const search of searches) {
        setRefreshingId(search.id);
        await api.refreshGoogleNewsSearches(search.id);
        // Reload after each so timestamps update as we go
        const updated = await api.listGoogleNewsSearches();
        setSearches(updated);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshingId(null);
      setRefreshingAll(false);
    }
  };

  const handleRefreshOne = async (search) => {
    setRefreshingId(search.id);
    setError(null);
    try {
      await api.refreshGoogleNewsSearches(search.id);
      await loadSearches();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (search) => {
    if (!window.confirm(`Remove "${search.name}"?`)) return;
    try {
      await api.deleteGoogleNewsSearch(search.id);
      await loadSearches();
    } catch (e) {
      setError(e.message);
    }
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditState({
      keywords: s.keywords.join(', '),
      name: s.name,
      interval: s.interval_hours,
      lookback: s.lookback_days ?? 1,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditState({});
  };

  const saveEdit = async (s) => {
    const keywords = editState.keywords.split(',').map(k => k.trim()).filter(Boolean);
    if (!keywords.length) return;
    try {
      await api.updateGoogleNewsSearch(s.id, {
        keywords,
        name: editState.name.trim(),
        intervalHours: Number(editState.interval),
        lookbackDays: Number(editState.lookback),
      });
      setEditingId(null);
      setEditState({});
      await loadSearches();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const keywords = newKeywords.split(',').map(k => k.trim()).filter(Boolean);
    if (!keywords.length) return;
    setAddLoading(true);
    setAddError(null);
    try {
      await api.addGoogleNewsSearch(
        keywords,
        newName.trim(),
        Number(newInterval),
        Number(newLookback),
      );
      setNewKeywords('');
      setNewName('');
      setNewInterval(24);
      setNewLookback(1);
      await loadSearches();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <div className="kb-tab-body">
      {error && <div className="kb-error">{error}</div>}

      <div className="kb-gn-header">
        <div className="kb-gn-brand">
          <span className="kb-gn-logo">G</span>
          <span className="kb-gn-title">Google News Searches</span>
        </div>
        <div className="kb-gn-desc">
          Each entry searches Google News by keyword and ingests matching articles into the RAG.
          Results are deduplicated across refreshes.
        </div>
      </div>

      <div className="kb-feeds-toolbar">
        <button
          className="kb-btn-secondary"
          onClick={handleRefreshAll}
          disabled={refreshingAll || searches.length === 0}
        >
          {refreshingAll ? 'Refreshing...' : 'Refresh All'}
        </button>
      </div>

      {loading ? (
        <div className="kb-loading">Loading...</div>
      ) : searches.length === 0 ? (
        <div className="kb-empty">No Google News searches yet. Add one below.</div>
      ) : (
        <table className="kb-feeds-table">
          <thead>
            <tr>
              <th>Name / Keywords</th>
              <th>Interval</th>
              <th>Lookback</th>
              <th>Last fetched</th>
              <th>Docs</th>
              <th>Log</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {searches.map((s) => (
              editingId === s.id ? (
                <tr key={s.id} className="kb-gn-edit-row">
                  <td colSpan={5}>
                    <div className="kb-gn-edit-grid">
                      <label className="kb-label">
                        Keywords
                        <input
                          className="kb-input"
                          value={editState.keywords}
                          onChange={(e) => setEditState(p => ({ ...p, keywords: e.target.value }))}
                          placeholder="keyword1, keyword2"
                        />
                      </label>
                      <label className="kb-label">
                        Name
                        <input
                          className="kb-input"
                          value={editState.name}
                          onChange={(e) => setEditState(p => ({ ...p, name: e.target.value }))}
                          placeholder="Auto from keywords"
                        />
                      </label>
                      <label className="kb-label">
                        Lookback (days)
                        <input
                          className="kb-input"
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={editState.lookback}
                          onChange={(e) => setEditState(p => ({ ...p, lookback: e.target.value }))}
                        />
                      </label>
                      <label className="kb-label">
                        Interval (hours)
                        <input
                          className="kb-input"
                          type="number"
                          min={1}
                          value={editState.interval}
                          onChange={(e) => setEditState(p => ({ ...p, interval: e.target.value }))}
                        />
                      </label>
                    </div>
                  </td>
                  <td colSpan={2}>
                    <div className="kb-gn-edit-actions">
                      <button className="kb-btn-primary" onClick={() => saveEdit(s)}>Save</button>
                      <button className="kb-btn-secondary" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={s.id} className={refreshingId === s.id ? 'kb-row-refreshing' : ''}>
                  <td>
                    <div className="kb-feed-name">
                      {refreshingId === s.id && <span className="kb-spin" title="Refreshing…" />}
                      {s.name}
                    </div>
                    <div className="kb-gn-keywords">
                      {s.keywords.map(kw => (
                        <span key={kw} className="kb-keyword-badge">{kw}</span>
                      ))}
                    </div>
                  </td>
                  <td>{s.interval_hours}h</td>
                  <td>{s.lookback_days ?? 1}d</td>
                  <td className="kb-muted" title={s.last_fetched ? new Date(s.last_fetched).toLocaleString() : ''}>
                    {s.last_fetched ? formatRelative(s.last_fetched) : 'Never'}
                  </td>
                  <td className="kb-muted">{s.doc_count ?? 0}</td>
                  <td>
                    <button
                      className="kb-log-link-btn"
                      onClick={() => onViewLog(s)}
                      title="View activity log for this search"
                    >
                      View log
                    </button>
                  </td>
                  <td>
                    <div className="kb-feed-actions">
                      <button
                        className="kb-icon-btn"
                        onClick={() => startEdit(s)}
                        title="Edit this search"
                      >
                        ✎
                      </button>
                      <button
                        className="kb-icon-btn"
                        onClick={() => handleRefreshOne(s)}
                        disabled={refreshingId === s.id}
                        title="Refresh this search now"
                      >
                        {refreshingId === s.id ? '…' : '↺'}
                      </button>
                      <button
                        className="kb-delete-btn"
                        onClick={() => handleDelete(s)}
                        title="Remove search"
                      >
                        x
                      </button>
                    </div>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      )}

      {/* Add new search */}
      <div className="kb-feeds-add">
        <div className="kb-feeds-add-title">Add Google News Search</div>
        {addError && <div className="kb-error" style={{ marginBottom: 10 }}>{addError}</div>}
        <form className="kb-form" onSubmit={handleAdd}>
          <div className="kb-form-grid">
            <label className="kb-label" style={{ gridColumn: '1 / -1' }}>
              Keywords <span className="kb-muted">(comma-separated — these become the search query)</span>
              <input
                className="kb-input"
                type="text"
                value={newKeywords}
                onChange={(e) => setNewKeywords(e.target.value)}
                placeholder="e.g. Iran nuclear deal, IAEA"
                required
              />
            </label>
            <label className="kb-label">
              Name <span className="kb-muted">(optional)</span>
              <input
                className="kb-input"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Auto-generated from keywords"
              />
            </label>
            <label className="kb-label">
              Look back (days)
              <input
                className="kb-input"
                type="number"
                min={0.5}
                step={0.5}
                value={newLookback}
                onChange={(e) => setNewLookback(e.target.value)}
              />
            </label>
            <label className="kb-label">
              Refresh interval (hours)
              <input
                className="kb-input"
                type="number"
                min={1}
                value={newInterval}
                onChange={(e) => setNewInterval(e.target.value)}
              />
            </label>
          </div>
          <button
            className="kb-btn-primary"
            type="submit"
            disabled={addLoading || !newKeywords.trim()}
          >
            {addLoading ? 'Adding...' : 'Add Search'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Activity Log Tab ─────────────────────────────────────────────────────────

function ActivityLogTab({ feedFilter, onClearFilter }) {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  const loadLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getFeedLog(500);
      setLog(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLog();
    const interval = setInterval(loadLog, 30000);
    return () => clearInterval(interval);
  }, [loadLog]);

  // Reset expand state when filter changes
  useEffect(() => { setExpanded({}); }, [feedFilter]);

  const toggleExpanded = (i) =>
    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));

  // Apply feed filter
  const visibleLog = feedFilter
    ? log.filter((e) => e.feed_url === feedFilter.url)
    : log;

  // Aggregate all unique articles added to RAG for the filtered feed
  const allArticles = feedFilter
    ? (() => {
        const seen = new Set();
        const result = [];
        for (const entry of visibleLog) {
          for (const art of (entry.articles || [])) {
            if (art.url && !seen.has(art.url)) {
              seen.add(art.url);
              result.push(art);
            }
          }
        }
        return result;
      })()
    : [];

  return (
    <div className="kb-tab-body">
      {error && <div className="kb-error">{error}</div>}

      {/* Feed filter header */}
      {feedFilter && (
        <div className="kb-log-filter-header">
          <div className="kb-log-filter-title">
            <span className="kb-log-filter-label">Feed:</span>
            <span className="kb-log-filter-name">{feedFilter.name}</span>
          </div>
          <button className="kb-btn-secondary" onClick={onClearFilter}>
            ← All feeds
          </button>
        </div>
      )}

      {/* "Added to RAG" summary — only shown when filtered to a specific feed */}
      {feedFilter && (
        <div className="kb-rag-summary">
          <div className="kb-rag-summary-header">
            <span className="kb-rag-summary-title">
              Added to RAG
            </span>
            <span className="kb-rag-summary-count">
              {allArticles.length} article{allArticles.length !== 1 ? 's' : ''} across {visibleLog.length} refresh{visibleLog.length !== 1 ? 'es' : ''}
            </span>
          </div>
          {allArticles.length === 0 ? (
            <div className="kb-rag-empty">
              No articles ingested yet. Click Refresh in the News Feeds tab.
            </div>
          ) : (
            <ul className="kb-rag-article-list">
              {allArticles.map((art, i) => (
                <li key={i} className="kb-rag-article-item">
                  {art.url ? (
                    <a
                      href={art.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="kb-rag-article-link"
                    >
                      {art.title || art.url}
                    </a>
                  ) : (
                    <span>{art.title || '—'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Refresh history */}
      <div className="kb-log-toolbar">
        <span className="kb-log-section-label">
          {feedFilter ? 'Refresh history' : 'All activity'}
        </span>
        <button className="kb-btn-secondary" onClick={loadLog} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <span className="kb-muted" style={{ fontSize: 12 }}>Auto-refreshes every 30s</span>
      </div>

      {loading && log.length === 0 ? (
        <div className="kb-loading">Loading...</div>
      ) : visibleLog.length === 0 ? (
        <div className="kb-empty">
          {feedFilter
            ? 'No activity for this feed yet.'
            : 'No feed activity yet. Add a feed and click Refresh.'}
        </div>
      ) : (
        <div className="kb-log-entries">
          {visibleLog.map((entry, i) => {
            const articles = entry.articles || [];
            const isOpen = !!expanded[i];
            return (
              <div key={i} className={`kb-log-entry ${i % 2 === 0 ? 'kb-log-entry-even' : ''}`}>
                <div className="kb-log-entry-header">
                  <span
                    className="kb-log-time"
                    title={entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}
                  >
                    {entry.timestamp ? formatRelative(entry.timestamp) : '—'}
                  </span>
                  {!feedFilter && (
                    <span className="kb-log-feed-name" title={entry.feed_url || ''}>
                      {entry.feed_name || entry.feed_url || '—'}
                    </span>
                  )}
                  {entry.search_mode && (
                    <span className={`kb-log-mode kb-log-mode-${entry.search_mode}`}>
                      {entry.search_mode}
                    </span>
                  )}
                  <div className="kb-log-stats">
                    <span className="kb-log-ingested">{entry.ingested ?? 0} ingested</span>
                    <span className="kb-muted">{entry.skipped_date ?? 0} old</span>
                    <span className="kb-muted">{entry.skipped_keyword ?? 0} no-kw</span>
                    {(entry.skipped_similar ?? 0) > 0 && (
                      <span className="kb-log-dedup" title="Discarded as near-duplicates (similarity > 95%)">
                        {entry.skipped_similar} dupes
                      </span>
                    )}
                    <span className="kb-muted">{entry.total_entries ?? 0} total</span>
                  </div>
                  {articles.length > 0 && (
                    <button
                      className="kb-log-toggle"
                      onClick={() => toggleExpanded(i)}
                    >
                      {isOpen ? '▲' : '▼'} {articles.length} article{articles.length !== 1 ? 's' : ''}
                    </button>
                  )}
                </div>

                {entry.keywords && entry.keywords.length > 0 && (
                  <div className="kb-log-meta">
                    Keywords: {entry.keywords.join(', ')}
                    {entry.lookback_days != null && ` · ${entry.lookback_days}d lookback`}
                  </div>
                )}

                {isOpen && articles.length > 0 && (
                  <ul className="kb-log-articles">
                    {articles.map((art, j) => (
                      <li key={j} className="kb-log-article">
                        {art.url ? (
                          <a
                            href={art.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="kb-log-article-link"
                          >
                            {art.title || art.url}
                          </a>
                        ) : (
                          <span>{art.title || '—'}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Graph DB Tab ─────────────────────────────────────────────────────────────

const GRAPH_COLORS = {
  rss:    '#ff7043',
  url:    '#66bb6a',
  file:   '#ab47bc',
  manual: '#42a5f5',
};
const DEFAULT_COLOR = '#90a4ae';

function nodeColor(node) {
  return GRAPH_COLORS[node.source_type] || DEFAULT_COLOR;
}

function GraphDBTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const ForceGraph3DRef = useRef(null);
  const [ForceGraph3D, setForceGraph3D] = useState(null);

  // Lazy-load ForceGraph3D (it's large)
  useEffect(() => {
    import('react-force-graph-3d').then((mod) => {
      setForceGraph3D(() => mod.default);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getGraphData());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Track container size for responsive canvas
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Prepare graph data with fixed PCA positions
  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    return {
      nodes: data.nodes.map((n) => ({ ...n, fx: n.x, fy: n.y, fz: n.z })),
      links: data.links,
    };
  }, [data]);

  const meta = data?.meta;

  if (error) return <div className="kb-tab-body"><div className="kb-error">{error}</div></div>;

  return (
    <div className="kb-graph-root">
      {/* Left: 3D canvas */}
      <div className="kb-graph-canvas-wrap" ref={containerRef}>
        {(loading && !data) ? (
          <div className="kb-graph-loading">Computing embeddings projection…</div>
        ) : ForceGraph3D && data ? (
          <ForceGraph3D
            ref={ForceGraph3DRef}
            graphData={graphData}
            width={dims.w}
            height={dims.h}
            backgroundColor="#0d1117"
            nodeId="id"
            nodeVal={4}
            nodeColor={(n) => n.id === selected?.id ? '#ffffff' : n.id === hoveredId ? '#ffe082' : nodeColor(n)}
            nodeOpacity={0.92}
            nodeLabel={(n) => `<div style="background:rgba(0,0,0,.8);color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;max-width:260px">${n.title}</div>`}
            linkColor={(l) => {
              const sim = l.similarity ?? 0;
              const alpha = Math.round(((sim - 0.45) / 0.55) * 180 + 30);
              return `rgba(144,164,174,${(alpha / 255).toFixed(2)})`;
            }}
            linkWidth={(l) => Math.max(0.3, (l.similarity - 0.45) * 3)}
            linkDirectionalParticles={0}
            enableNodeDrag={false}
            onNodeClick={(node) => setSelected((s) => s?.id === node.id ? null : node)}
            onNodeHover={(node) => setHoveredId(node?.id ?? null)}
            cooldownTicks={0}
          />
        ) : null}

        {/* Overlay: legend + controls hint */}
        {data && (
          <div className="kb-graph-overlay">
            <div className="kb-graph-legend">
              {Object.entries(GRAPH_COLORS).map(([type, color]) => (
                (meta?.by_source_type?.[type] ?? 0) > 0 && (
                  <div key={type} className="kb-graph-legend-item">
                    <span className="kb-graph-legend-dot" style={{ background: color }} />
                    <span>{type} ({meta.by_source_type[type]})</span>
                  </div>
                )
              ))}
            </div>
            <div className="kb-graph-hint">Drag to rotate · Scroll to zoom · Click node for details</div>
          </div>
        )}
      </div>

      {/* Right: details panel */}
      <div className="kb-graph-sidebar">
        {/* Stats */}
        {meta && (
          <div className="kb-graph-stats">
            <div className="kb-graph-stat-row">
              <span className="kb-graph-stat-label">Nodes</span>
              <span className="kb-graph-stat-val">{meta.total_nodes}</span>
            </div>
            <div className="kb-graph-stat-row">
              <span className="kb-graph-stat-label">Edges</span>
              <span className="kb-graph-stat-val">{meta.total_edges}</span>
            </div>
            <div className="kb-graph-stat-row">
              <span className="kb-graph-stat-label">Similarity cutoff</span>
              <span className="kb-graph-stat-val">{(meta.similarity_cutoff * 100).toFixed(0)}%</span>
            </div>
            {meta.pca_explained_variance && (
              <div className="kb-graph-stat-row kb-graph-stat-pca">
                <span className="kb-graph-stat-label">PCA variance explained</span>
                <span className="kb-graph-stat-val">
                  {meta.pca_explained_variance.map((v, i) => (
                    <span key={i} className="kb-graph-pca-pill">PC{i + 1} {v}%</span>
                  ))}
                </span>
              </div>
            )}
            {meta.by_feed && Object.keys(meta.by_feed).length > 0 && (
              <div className="kb-graph-feeds">
                <div className="kb-graph-feeds-label">Top feeds</div>
                {Object.entries(meta.by_feed).map(([name, count]) => (
                  <div key={name} className="kb-graph-feed-row">
                    <span className="kb-graph-feed-name">{name}</span>
                    <span className="kb-graph-feed-count">{count}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="kb-btn-secondary" onClick={load} disabled={loading} style={{ marginTop: 12, width: '100%' }}>
              {loading ? 'Computing…' : 'Refresh'}
            </button>
          </div>
        )}

        {/* Selected node detail */}
        {selected ? (
          <div className="kb-graph-detail">
            <div className="kb-graph-detail-header">
              <span className={`kb-badge kb-badge-${selected.source_type}`}>{selected.source_type}</span>
              <button className="kb-graph-detail-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="kb-graph-detail-title">{selected.title}</div>
            {selected.feed_name && (
              <div className="kb-graph-detail-meta">
                <span className="kb-graph-detail-key">Feed</span>
                <span className="kb-doc-feed" style={{ cursor: 'default' }}>{selected.feed_name}</span>
              </div>
            )}
            <div className="kb-graph-detail-meta">
              <span className="kb-graph-detail-key">Added</span>
              <span>{formatRelative(selected.created_at)}</span>
            </div>
            {selected.source_url && (
              <div className="kb-graph-detail-meta">
                <span className="kb-graph-detail-key">URL</span>
                <a href={selected.source_url} target="_blank" rel="noopener noreferrer" className="kb-graph-detail-url">
                  {selected.source_url}
                </a>
              </div>
            )}
            <div className="kb-graph-detail-coords">
              <span className="kb-graph-detail-key">Position</span>
              <span className="kb-mono" style={{ fontSize: 11 }}>
                x={selected.x.toFixed(1)} y={selected.y.toFixed(1)} z={selected.z.toFixed(1)}
              </span>
            </div>

            {/* Nearest neighbours from graph links */}
            {(() => {
              if (!data) return null;
              const neighbors = data.links
                .filter((l) => l.source === selected.id || l.target === selected.id)
                .map((l) => {
                  const otherId = l.source === selected.id ? l.target : l.source;
                  const other = data.nodes.find((n) => n.id === otherId);
                  return other ? { ...other, similarity: l.similarity } : null;
                })
                .filter(Boolean)
                .sort((a, b) => b.similarity - a.similarity);
              if (!neighbors.length) return null;
              return (
                <div className="kb-graph-neighbors">
                  <div className="kb-graph-neighbors-label">Connected nodes</div>
                  {neighbors.map((nb) => (
                    <div key={nb.id} className="kb-graph-neighbor-row" onClick={() => setSelected(nb)}>
                      <SimilarityBar value={nb.similarity} />
                      <span className={`kb-badge kb-badge-${nb.source_type}`} style={{ fontSize: 9 }}>{nb.source_type}</span>
                      <span className="kb-graph-neighbor-title">{nb.title}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="kb-graph-detail-empty">
            Click a node to see document details and its connections.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Vector Index Tab ─────────────────────────────────────────────────────────

const FILE_TYPE_LABELS = {
  sqlite: 'SQLite metadata',
  'hnsw-header': 'HNSW header',
  'hnsw-level0': 'HNSW level-0 graph',
  'hnsw-links': 'HNSW link lists',
  'hnsw-data': 'HNSW data',
  config: 'Config JSON',
  other: 'Other',
};

function SimilarityBar({ value }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? '#2e7d32' : value >= 0.6 ? '#e65c00' : '#4a90e2';
  return (
    <span className="kb-sim-bar-wrap">
      <span className="kb-sim-bar" style={{ width: `${pct}%`, background: color }} />
      <span className="kb-sim-pct" style={{ color }}>{pct}%</span>
    </span>
  );
}

function VectorIndexTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [showFiles, setShowFiles] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getVectorIndex());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  if (loading && !data) return <div className="kb-loading">Computing index stats…</div>;
  if (error) return <div className="kb-tab-body"><div className="kb-error">{error}</div></div>;
  if (!data) return null;

  const { collection, nearest_neighbors, index_files } = data;
  const { hnsw } = collection;

  const distanceLabel = { l2: 'L2 (Euclidean)', cosine: 'Cosine', ip: 'Inner product' };

  const visibleDocs = (nearest_neighbors || []).filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return d.title.toLowerCase().includes(q) || (d.feed_name || '').toLowerCase().includes(q);
  });

  const totalIndexSize = (index_files || []).reduce((s, f) => s + f.size, 0);

  return (
    <div className="kb-tab-body">
      <div className="kb-vi-toolbar">
        <button className="kb-btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Computing…' : 'Refresh'}
        </button>
      </div>

      {/* Collection overview */}
      <div className="kb-stat-section-label">Index Configuration</div>
      <div className="kb-vi-config-grid">
        <div className="kb-vi-config-card">
          <div className="kb-vi-config-label">Collection</div>
          <div className="kb-vi-config-value kb-mono">{collection.name}</div>
        </div>
        <div className="kb-vi-config-card">
          <div className="kb-vi-config-label">Total vectors</div>
          <div className="kb-vi-config-value">{collection.total_chunks.toLocaleString()}</div>
        </div>
        <div className="kb-vi-config-card">
          <div className="kb-vi-config-label">Unique documents</div>
          <div className="kb-vi-config-value">{collection.unique_documents.toLocaleString()}</div>
        </div>
        <div className="kb-vi-config-card">
          <div className="kb-vi-config-label">Embedding model</div>
          <div className="kb-vi-config-value kb-mono">{collection.embedding_model}</div>
        </div>
        <div className="kb-vi-config-card">
          <div className="kb-vi-config-label">Dimensions</div>
          <div className="kb-vi-config-value">{collection.embedding_dimensions}</div>
        </div>
        <div className="kb-vi-config-card">
          <div className="kb-vi-config-label">Distance metric</div>
          <div className="kb-vi-config-value">{distanceLabel[hnsw.space] || hnsw.space}</div>
        </div>
      </div>

      {/* HNSW parameters */}
      <div className="kb-stat-section-label">HNSW Parameters</div>
      <div className="kb-vi-hnsw-table">
        {[
          { key: 'M', label: 'M (max connections / node)', desc: 'Higher → better recall, more memory' },
          { key: 'construction_ef', label: 'ef_construction', desc: 'Candidates considered at build time' },
          { key: 'search_ef', label: 'ef_search', desc: 'Candidates considered at query time' },
          { key: 'num_threads', label: 'num_threads', desc: 'Parallel threads for index build' },
        ].map(({ key, label, desc }) => (
          <div key={key} className="kb-vi-hnsw-row">
            <span className="kb-vi-hnsw-key kb-mono">{label}</span>
            <span className="kb-vi-hnsw-val">{hnsw[key]}</span>
            <span className="kb-vi-hnsw-desc">{desc}</span>
          </div>
        ))}
      </div>

      {/* Nearest-neighbor relationships */}
      <div className="kb-vi-nn-header">
        <div className="kb-stat-section-label" style={{ margin: 0 }}>
          Document Relationships — nearest neighbours by cosine similarity
        </div>
        <input
          className="kb-search"
          style={{ width: 260 }}
          placeholder="Filter by title or feed…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="kb-vi-nn-count">{visibleDocs.length} of {nearest_neighbors.length} documents</div>

      <div className="kb-vi-nn-list">
        {visibleDocs.map((doc) => (
          <div key={doc.doc_id} className="kb-vi-nn-item">
            <div className="kb-vi-nn-row" onClick={() => toggle(doc.doc_id)}>
              <span className="kb-vi-nn-chevron">{expanded[doc.doc_id] ? '▼' : '▶'}</span>
              <SourceBadge type={doc.source_type} />
              {doc.feed_name && <span className="kb-doc-feed" style={{ cursor: 'default' }}>{doc.feed_name}</span>}
              <span className="kb-vi-nn-title">{doc.title}</span>
              <span className="kb-vi-nn-meta">{formatDate(doc.created_at)}</span>
            </div>
            {expanded[doc.doc_id] && (
              <div className="kb-vi-nn-neighbors">
                {doc.neighbors.map((n) => (
                  <div key={n.doc_id} className="kb-vi-nn-neighbor">
                    <SimilarityBar value={n.similarity} />
                    <SourceBadge type={n.source_type} />
                    {n.feed_name && <span className="kb-doc-feed" style={{ cursor: 'default', fontSize: 10 }}>{n.feed_name}</span>}
                    <span className="kb-vi-nn-neighbor-title">{n.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Index files */}
      <div className="kb-vi-files-header" onClick={() => setShowFiles((p) => !p)}>
        <span>{showFiles ? '▼' : '▶'}</span>
        <span className="kb-stat-section-label" style={{ margin: 0 }}>
          Index Files — {formatBytes(totalIndexSize)} total
        </span>
      </div>
      {showFiles && (
        <div className="kb-vi-files-table">
          <div className="kb-vi-files-head">
            <span>Path</span><span>Type</span><span>Size</span>
          </div>
          {(index_files || []).map((f) => (
            <div key={f.path} className="kb-vi-files-row">
              <span className="kb-mono kb-vi-file-path">{f.path}</span>
              <span className={`kb-vi-file-type kb-vi-file-type-${f.type}`}>{FILE_TYPE_LABELS[f.type] || f.type}</span>
              <span className="kb-vi-file-size">{formatBytes(f.size)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stats Tab ────────────────────────────────────────────────────────────────

function StatsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await api.getKnowledgeStats());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !stats) return <div className="kb-loading">Loading stats...</div>;
  if (error) return <div className="kb-tab-body"><div className="kb-error">{error}</div></div>;
  if (!stats) return null;

  const { collection, google_news, activity_log, storage, paths, embedding } = stats;

  const sourceOrder = ['rss', 'url', 'file', 'manual'];
  const sourceLabels = { rss: 'RSS / Web', url: 'URL', file: 'File', manual: 'Manual' };
  const sourceTypes = Object.entries(collection.by_source_type || {}).sort(
    ([a], [b]) => (sourceOrder.indexOf(a) - sourceOrder.indexOf(b))
  );

  const storageRows = [
    { label: 'Vector index', bytes: storage.chroma_vectors, desc: 'HNSW embedding index' },
    { label: 'Metadata (SQLite)', bytes: storage.chroma_sqlite, desc: 'ChromaDB metadata & documents' },
    { label: 'Activity log', bytes: storage.activity_log, desc: 'data/retrieval_log.jsonl' },
    { label: 'Conversations', bytes: storage.conversations, desc: 'data/conversations/' },
    { label: 'Google News config', bytes: storage.google_news_config, desc: 'data/google_news.json' },
  ];
  const totalStorage = storageRows.reduce((s, r) => s + r.bytes, 0);

  return (
    <div className="kb-tab-body">
      <div className="kb-stats-refresh">
        <button className="kb-btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Key metrics */}
      <div className="kb-stat-section-label">Collection</div>
      <div className="kb-stat-cards">
        <StatCard value={collection.total_documents} label="Documents" />
        <StatCard value={collection.total_chunks} label="Chunks" />
        <StatCard value={collection.avg_chunks_per_doc} label="Avg chunks / doc" />
        <StatCard value={google_news?.searches ?? 0} label="Google News searches" />
        <StatCard value={activity_log.entry_count} label="Activity log entries" />
      </div>

      {/* Source type breakdown */}
      {sourceTypes.length > 0 && (
        <>
          <div className="kb-stat-section-label">Documents by source</div>
          <div className="kb-stat-source-grid">
            {sourceTypes.map(([type, count]) => (
              <div key={type} className="kb-stat-source-row">
                <SourceBadge type={type} />
                <div className="kb-stat-source-bar-wrap">
                  <div
                    className="kb-stat-source-bar"
                    style={{ width: `${Math.round((count / collection.total_documents) * 100)}%` }}
                  />
                </div>
                <span className="kb-stat-source-count">{count}</span>
                <span className="kb-muted" style={{ fontSize: 12 }}>
                  {Math.round((count / collection.total_documents) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Storage breakdown */}
      <div className="kb-stat-section-label">Storage — {formatBytes(totalStorage)} total</div>
      <div className="kb-stat-storage-table">
        {storageRows.map((row) => (
          <div key={row.label} className="kb-stat-storage-row">
            <div className="kb-stat-storage-info">
              <span className="kb-stat-storage-label">{row.label}</span>
              <span className="kb-stat-storage-desc">{row.desc}</span>
            </div>
            <div className="kb-stat-storage-bar-wrap">
              <div
                className="kb-stat-storage-bar"
                style={{ width: totalStorage > 0 ? `${Math.round((row.bytes / totalStorage) * 100)}%` : '0%' }}
              />
            </div>
            <span className="kb-stat-storage-size">{formatBytes(row.bytes)}</span>
          </div>
        ))}
      </div>

      {/* System info */}
      <div className="kb-stat-section-label">System</div>
      <div className="kb-stat-info-grid">
        <InfoRow label="Data directory" value={paths.data_dir} mono />
        <InfoRow label="ChromaDB path" value={paths.chroma_dir} mono />
        <InfoRow label="Activity log" value={activity_log.path} mono />
        <InfoRow label="Embedding model" value={`${embedding.model} (${embedding.provider})`} />
        <InfoRow label="Embedding dimensions" value={String(embedding.dimensions)} />
      </div>
    </div>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="kb-stat-card">
      <div className="kb-stat-card-value">{value}</div>
      <div className="kb-stat-card-label">{label}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div className="kb-stat-info-row">
      <span className="kb-stat-info-label">{label}</span>
      <span className={`kb-stat-info-value ${mono ? 'kb-mono' : ''}`}>{value}</span>
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatRelative(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return formatDate(iso);
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}
