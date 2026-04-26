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

  async getFeedLog(limit = 200) {
    const response = await fetch(`${API_BASE}/api/knowledge/feeds/log?limit=${limit}`);
    if (!response.ok) {
      throw new Error('Failed to fetch feed log');
    }
    return response.json();
  },

  async getKnowledgeStats() {
    const response = await fetch(`${API_BASE}/api/knowledge/stats`);
    if (!response.ok) throw new Error('Failed to fetch knowledge base stats');
    return response.json();
  },

  async getVectorIndex() {
    const response = await fetch(`${API_BASE}/api/knowledge/vector-index`);
    if (!response.ok) throw new Error('Failed to fetch vector index');
    return response.json();
  },

  async getGraphData() {
    const response = await fetch(`${API_BASE}/api/knowledge/graph`);
    if (!response.ok) throw new Error('Failed to fetch graph data');
    return response.json();
  },

  // Google News search methods

  async listGoogleNewsSearches() {
    const response = await fetch(`${API_BASE}/api/knowledge/google-news`);
    if (!response.ok) throw new Error('Failed to list Google News searches');
    return response.json();
  },

  async addGoogleNewsSearch(keywords, name = '', intervalHours = 1, lookbackDays = 1.0) {
    const response = await fetch(`${API_BASE}/api/knowledge/google-news`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords,
        name,
        interval_hours: intervalHours,
        lookback_days: lookbackDays,
      }),
    });
    if (!response.ok) throw new Error('Failed to add Google News search');
    return response.json();
  },

  async updateGoogleNewsSearch(id, { keywords, name, intervalHours, lookbackDays }) {
    const body = {};
    if (keywords !== undefined) body.keywords = keywords;
    if (name !== undefined) body.name = name;
    if (intervalHours !== undefined) body.interval_hours = intervalHours;
    if (lookbackDays !== undefined) body.lookback_days = lookbackDays;
    const response = await fetch(`${API_BASE}/api/knowledge/google-news/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Failed to update Google News search');
    return response.json();
  },

  async deleteGoogleNewsSearch(id) {
    const response = await fetch(`${API_BASE}/api/knowledge/google-news/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete Google News search');
    return response.json();
  },

  async refreshGoogleNewsSearches(id = null) {
    const response = await fetch(`${API_BASE}/api/knowledge/google-news/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) throw new Error('Failed to refresh Google News searches');
    return response.json();
  },
};
