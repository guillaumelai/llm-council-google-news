/**
 * API client for the LLM Council backend.
 */

const API_BASE = 'http://localhost:8001';

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {boolean} useRag - Whether to use RAG for context retrieval
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent, useRag = false) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, use_rag: useRag }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  },

  // Knowledge base methods

  /**
   * List all documents in the knowledge base.
   */
  async listDocuments() {
    const response = await fetch(`${API_BASE}/api/knowledge/documents`);
    if (!response.ok) {
      throw new Error('Failed to list documents');
    }
    return response.json();
  },

  /**
   * Get a specific document including its chunks.
   * @param {string} docId - The document ID
   */
  async getDocument(docId) {
    const response = await fetch(`${API_BASE}/api/knowledge/documents/${docId}`);
    if (!response.ok) {
      throw new Error('Failed to get document');
    }
    return response.json();
  },

  /**
   * Delete a document from the knowledge base.
   * @param {string} docId - The document ID
   */
  async deleteDocument(docId) {
    const response = await fetch(
      `${API_BASE}/api/knowledge/documents/${docId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to delete document');
    }
    return response.json();
  },

  /**
   * Add text content to the knowledge base.
   * @param {string} title - The document title
   * @param {string} text - The text content
   */
  async addText(title, text) {
    const response = await fetch(`${API_BASE}/api/knowledge/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, text }),
    });
    if (!response.ok) {
      throw new Error('Failed to add text');
    }
    return response.json();
  },

  /**
   * Add a URL to the knowledge base.
   * @param {string} url - The URL to fetch and index
   */
  async addUrl(url) {
    const response = await fetch(`${API_BASE}/api/knowledge/url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      throw new Error('Failed to add URL');
    }
    return response.json();
  },

  /**
   * Upload a file to the knowledge base.
   * @param {File} file - The file to upload
   */
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/api/knowledge/file`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      throw new Error('Failed to upload file');
    }
    return response.json();
  },

  /**
   * List all RSS/Atom feeds.
   */
  async listFeeds() {
    const response = await fetch(`${API_BASE}/api/knowledge/feeds`);
    if (!response.ok) {
      throw new Error('Failed to list feeds');
    }
    return response.json();
  },

  /**
   * Add an RSS/Atom feed to the knowledge base.
   * @param {string} url - The feed URL
   * @param {string} name - The feed name
   * @param {number} intervalHours - How often to refresh in hours
   */
  async addFeed(url, name, intervalHours = 1) {
    const response = await fetch(`${API_BASE}/api/knowledge/feeds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, name, interval_hours: intervalHours }),
    });
    if (!response.ok) {
      throw new Error('Failed to add feed');
    }
    return response.json();
  },

  /**
   * Delete a feed from the knowledge base.
   * @param {string} url - The feed URL
   */
  async deleteFeed(url) {
    const response = await fetch(
      `${API_BASE}/api/knowledge/feeds/${encodeURIComponent(url)}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to delete feed');
    }
    return response.json();
  },

  /**
   * Refresh feeds in the knowledge base.
   * @param {string|null} url - Specific feed URL to refresh, or null to refresh all
   */
  async refreshFeeds(url = null) {
    const response = await fetch(`${API_BASE}/api/knowledge/feeds/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      throw new Error('Failed to refresh feeds');
    }
    return response.json();
  },
};
