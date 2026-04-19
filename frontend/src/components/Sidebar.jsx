import { useState } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onToggleKnowledgeBase,
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
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
        <button className="knowledge-base-btn" onClick={onToggleKnowledgeBase}>
          Knowledge Base
        </button>
      </div>

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
                  ×
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
