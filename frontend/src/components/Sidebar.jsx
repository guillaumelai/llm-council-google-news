import { useState } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  view,
  onNavigate,
}) {
  const [hoveredId, setHoveredId] = useState(null);

  const handleDelete = (e, id) => {
    e.stopPropagation();
    if (window.confirm('Delete this conversation?')) {
      onDeleteConversation(id);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <div className="kb-nav-row">
          <button
            className={`kb-nav-btn ${view === 'chat' ? 'kb-nav-btn--active' : ''}`}
            onClick={() => onNavigate('chat')}
          >
            Chat
          </button>
          <button
            className={`kb-nav-btn ${view === 'knowledge' ? 'kb-nav-btn--active' : ''}`}
            onClick={() => onNavigate('knowledge')}
          >
            Knowledge Base
          </button>
        </div>
        {view === 'chat' && (
          <button className="new-conversation-btn" onClick={onNewConversation}>
            + New Conversation
          </button>
        )}
      </div>

      {view === 'chat' && (
        <div className="conversation-list">
          {conversations.length === 0 ? (
            <div className="no-conversations">No conversations yet</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${
                  conv.id === currentConversationId ? 'active' : ''
                }`}
                onClick={() => onSelectConversation(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="conversation-item-content">
                  <div className="conversation-title">
                    {conv.title || 'New Conversation'}
                  </div>
                  <div className="conversation-meta">
                    {conv.message_count} messages
                  </div>
                </div>
                {hoveredId === conv.id && (
                  <button
                    className="delete-conversation-btn"
                    onClick={(e) => handleDelete(e, conv.id)}
                    title="Delete conversation"
                  >
                    x
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
