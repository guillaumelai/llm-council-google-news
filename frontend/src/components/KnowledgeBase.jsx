import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import './KnowledgeBase.css';

export default function KnowledgeBase({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('documents');

  if (!isOpen) return null;

  return (
    <>
      <div className="kb-backdrop" onClick={onClose} />
      <div className="kb-panel">
        <div className="kb-header">
          <h2 className="kb-title">Knowledge Base</h2>
          <button className="kb-close-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="kb-tabs">
          <button
            className={`kb-tab ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
          >
            Documents
          </button>
          <button
            className={`kb-tab ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => setActiveTab('add')}
          >
            Add Content
          </button>
          <button
            className={`kb-tab ${activeTab === 'feeds' ? 'active' : ''}`}
            onClick={() => setActiveTab('feeds')}
          >
            News Feeds
          </button>
        </div>

        <div className="kb-content">
          {activeTab === 'documents' && (
            <DocumentsTab onSwitchToAdd={() => setActiveTab('add')} />
          )}
          {activeTab === 'add' && (
            <AddContentTab onSuccess={() => setActiveTab('documents')} />
          )}
          {activeTab === 'feeds' && <FeedsTab />}
        </div>
      </div>
    </>
  );
}

// ─── Documents Tab ────────────────────────────────────────────────────────────

function DocumentsTab({ onSwitchToAdd }) {
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
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

  const handlePreview = async (doc) => {
    try {
      const full = await api.getDocument(doc.doc_id);
      setPreview(full);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (e, doc) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    try {
      await api.deleteDocument(doc.doc_id);
      await loadDocuments();
    } catch (e) {
      setError(e.message);
    }
  };

  const filtered = documents.filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="kb-tab-body">
      {error && <div className="kb-error">{error}</div>}

      <input
        className="kb-search"
        type="text"
        placeholder="Search documents..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <div className="kb-loading">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="kb-empty">
          {documents.length === 0
            ? "No documents yet. Add content in the 'Add Content' tab."
            : 'No documents match your search.'}
        </div>
      ) : (
        <div className="kb-doc-list">
          {filtered.map((doc) => (
            <div
              key={doc.doc_id}
              className="kb-doc-row"
              onClick={() => handlePreview(doc)}
            >
              <div className="kb-doc-info">
                <span className="kb-doc-title">{doc.title}</span>
                <div className="kb-doc-meta">
                  <SourceBadge type={doc.source_type} />
                  <span className="kb-doc-date">
                    {formatDate(doc.created_at)}
                  </span>
                </div>
              </div>
              <button
                className="kb-delete-btn"
                onClick={(e) => handleDelete(e, doc)}
                title="Delete document"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <PreviewModal doc={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function SourceBadge({ type }) {
  const label = type || 'manual';
  return <span className={`kb-badge kb-badge-${label}`}>{label}</span>;
}

function PreviewModal({ doc, onClose }) {
  return (
    <div className="kb-preview-overlay" onClick={onClose}>
      <div
        className="kb-preview-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kb-preview-header">
          <h3 className="kb-preview-title">{doc.title}</h3>
          <button className="kb-close-btn" onClick={onClose}>
            ×
          </button>
        </div>
        {doc.source_url && (
          <div className="kb-preview-source">
            <a href={doc.source_url} target="_blank" rel="noopener noreferrer">
              {doc.source_url}
            </a>
          </div>
        )}
        <div className="kb-preview-chunks">
          {(doc.chunks || []).map((chunk, i) => (
            <div key={i} className="kb-chunk">
              <div className="kb-chunk-label">Chunk {i + 1}</div>
              <div className="kb-chunk-text">{chunk.text || chunk}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Add Content Tab ──────────────────────────────────────────────────────────

function AddContentTab({ onSuccess }) {
  const [subTab, setSubTab] = useState('text');

  return (
    <div className="kb-tab-body">
      <div className="kb-subtabs">
        {['text', 'url', 'file'].map((t) => (
          <button
            key={t}
            className={`kb-subtab ${subTab === t ? 'active' : ''}`}
            onClick={() => setSubTab(t)}
          >
            {t === 'text' ? 'Text' : t === 'url' ? 'URL' : 'File'}
          </button>
        ))}
      </div>

      {subTab === 'text' && <TextSubTab onSuccess={onSuccess} />}
      {subTab === 'url' && <UrlSubTab onSuccess={onSuccess} />}
      {subTab === 'file' && <FileSubTab onSuccess={onSuccess} />}
    </div>
  );
}

function TextSubTab({ onSuccess }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.addText(title.trim(), text.trim());
      setSuccess(true);
      setTitle('');
      setText('');
      setTimeout(onSuccess, 800);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="kb-form" onSubmit={handleSubmit}>
      {error && <div className="kb-error">{error}</div>}
      {success && <div className="kb-success">Document added</div>}
      <label className="kb-label">
        Title
        <input
          className="kb-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title"
          required
        />
      </label>
      <label className="kb-label">
        Content
        <textarea
          className="kb-textarea"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your text here..."
          required
        />
      </label>
      <button
        className="kb-btn-primary"
        type="submit"
        disabled={loading || !title.trim() || !text.trim()}
      >
        {loading ? 'Adding...' : 'Add Text'}
      </button>
    </form>
  );
}

function UrlSubTab({ onSuccess }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.addUrl(url.trim());
      setSuccess(true);
      setUrl('');
      setTimeout(onSuccess, 800);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="kb-form" onSubmit={handleSubmit}>
      {error && <div className="kb-error">{error}</div>}
      {success && <div className="kb-success">Document added</div>}
      <label className="kb-label">
        URL
        <input
          className="kb-input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          required
        />
      </label>
      <button
        className="kb-btn-primary"
        type="submit"
        disabled={loading || !url.trim()}
      >
        {loading ? 'Fetching...' : 'Fetch & Add'}
      </button>
    </form>
  );
}

function FileSubTab({ onSuccess }) {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef(null);

  const accept = '.txt,.md,.pdf';

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      await api.uploadFile(file);
      setSuccess(true);
      setFile(null);
      setTimeout(onSuccess, 800);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="kb-form" onSubmit={handleSubmit}>
      {error && <div className="kb-error">{error}</div>}
      {success && <div className="kb-success">Document added</div>}

      <div
        className={`kb-dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files[0] || null)}
        />
        {file ? (
          <div className="kb-dropzone-file">
            <span className="kb-dropzone-filename">{file.name}</span>
            <button
              type="button"
              className="kb-dropzone-clear"
              onClick={(e) => { e.stopPropagation(); setFile(null); }}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="kb-dropzone-prompt">
            <div className="kb-dropzone-icon">+</div>
            <div>Drag & drop a file here, or click to browse</div>
            <div className="kb-dropzone-hint">Accepts .txt, .md, .pdf</div>
          </div>
        )}
      </div>

      <button
        className="kb-btn-primary"
        type="submit"
        disabled={loading || !file}
      >
        {loading ? 'Uploading...' : 'Upload'}
      </button>
    </form>
  );
}

// ─── Feeds Tab ────────────────────────────────────────────────────────────────

function FeedsTab() {
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newInterval, setNewInterval] = useState(1);
  const [addLoading, setAddLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);

  const loadFeeds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listFeeds();
      setFeeds(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeeds();
  }, [loadFeeds]);

  const handleRefreshAll = async () => {
    setRefreshLoading(true);
    try {
      await api.refreshFeeds();
      await loadFeeds();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshLoading(false);
    }
  };

  const handleRefreshOne = async (feedUrl) => {
    try {
      await api.refreshFeeds(feedUrl);
      await loadFeeds();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (feedUrl) => {
    if (!window.confirm('Remove this feed?')) return;
    try {
      await api.deleteFeed(feedUrl);
      await loadFeeds();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setAddLoading(true);
    setError(null);
    try {
      await api.addFeed(newUrl.trim(), newName.trim(), Number(newInterval));
      setNewUrl('');
      setNewName('');
      setNewInterval(1);
      await loadFeeds();
    } catch (e) {
      setError(e.message);
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <div className="kb-tab-body">
      {error && <div className="kb-error">{error}</div>}

      <div className="kb-feeds-toolbar">
        <button
          className="kb-btn-secondary"
          onClick={handleRefreshAll}
          disabled={refreshLoading}
        >
          {refreshLoading ? 'Refreshing...' : 'Refresh All'}
        </button>
      </div>

      {loading ? (
        <div className="kb-loading">Loading...</div>
      ) : feeds.length === 0 ? (
        <div className="kb-empty">No feeds added yet.</div>
      ) : (
        <div className="kb-feeds-list">
          {feeds.map((feed) => (
            <div key={feed.url} className="kb-feed-row">
              <div className="kb-feed-info">
                <div className="kb-feed-name">{feed.name || feed.url}</div>
                <div className="kb-feed-url" title={feed.url}>
                  {truncate(feed.url, 45)}
                </div>
                <div className="kb-feed-meta">
                  Every {feed.interval_hours}h
                  {feed.last_fetched
                    ? ` · Last fetched ${formatDate(feed.last_fetched)}`
                    : ' · Never fetched'}
                  {feed.doc_count != null ? ` · ${feed.doc_count} docs` : ''}
                </div>
              </div>
              <div className="kb-feed-actions">
                <button
                  className="kb-icon-btn"
                  onClick={() => handleRefreshOne(feed.url)}
                  title="Refresh this feed"
                >
                  ↺
                </button>
                <button
                  className="kb-delete-btn"
                  onClick={() => handleDelete(feed.url)}
                  title="Remove feed"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="kb-feeds-add">
        <div className="kb-feeds-add-title">Add Feed</div>
        <form className="kb-form" onSubmit={handleAdd}>
          <label className="kb-label">
            Feed URL
            <input
              className="kb-input"
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              required
            />
          </label>
          <label className="kb-label">
            Name (optional)
            <input
              className="kb-input"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Feed"
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
          <button
            className="kb-btn-primary"
            type="submit"
            disabled={addLoading || !newUrl.trim()}
          >
            {addLoading ? 'Adding...' : 'Add Feed'}
          </button>
        </form>
      </div>
    </div>
  );
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

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}
