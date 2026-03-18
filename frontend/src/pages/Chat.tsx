import React, { useState, useEffect, useRef } from 'react';
import { chatAPI } from '../services/api';
import { ChatMessage, ChatResponse } from '../types';

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  /* this scrolls to the bottom of the page */
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadHistory = async () => {
    try {
      const history = await chatAPI.getHistory(20);
      setMessages(history);
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    // Add user message immediately
    const newMessage: ChatMessage = {
      message: userMessage,
      response: '',
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, newMessage]);

    try {
      const response: ChatResponse = await chatAPI.sendMessage(userMessage);
      
      // Update the message with the response
      setMessages(prev => 
        prev.map((msg, index) => 
          index === prev.length - 1 
            ? { ...msg, response: response.text, intent: response.intent }
            : msg
        )
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      // Update with error message
      setMessages(prev => 
        prev.map((msg, index) => 
          index === prev.length - 1 
            ? { ...msg, response: 'Sorry, I encountered an error. Please try again.' }
            : msg
        )
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ marginBottom: '20px', color: '#495057' }}>Chat Assistant</h1>
      
      {/* Messages Container */}
      <div style={{
        flex: 1,
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        padding: '20px',
        marginBottom: '20px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {messages.length === 0 ? (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#6c757d',
            textAlign: 'center'
          }}>
            <h3>Welcome to KanbanSync Assistant!</h3>
            <p>I can help you with:</p>
            <ul style={{ textAlign: 'left', marginTop: '20px' }}>
              <li>Setting up sync rules between platforms</li>
              <li>Managing your platform connections</li>
              <li>Checking sync status and history</li>
              <li>Troubleshooting sync issues</li>
            </ul>
            <p style={{ marginTop: '20px', fontStyle: 'italic' }}>
              Try asking: "Set up sync from Asana to Trello" or "Show my connections"
            </p>
          </div>
        ) : (
          <div style={{ flex: 1 }}>
            {messages.map((message, index) => (
              <div key={index} style={{ marginBottom: '20px' }}>
                {/* User Message */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginBottom: '10px'
                }}>
                  <div style={{
                    backgroundColor: '#007bff',
                    color: 'white',
                    padding: '10px 15px',
                    borderRadius: '18px',
                    maxWidth: '70%',
                    wordWrap: 'break-word'
                  }}>
                    {message.message}
                  </div>
                </div>

                {/* Assistant Response */}
                {message.response && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'flex-start'
                  }}>
                    <div style={{
                      backgroundColor: '#f8f9fa',
                      color: '#495057',
                      padding: '10px 15px',
                      borderRadius: '18px',
                      maxWidth: '70%',
                      wordWrap: 'break-word',
                      whiteSpace: 'pre-wrap'
                    }}>
                      {message.response}
                    </div>
                  </div>
                )}

                {/* Loading indicator for the last message */}
                {index === messages.length - 1 && !message.response && loading && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'flex-start'
                  }}>
                    <div style={{
                      backgroundColor: '#f8f9fa',
                      color: '#6c757d',
                      padding: '10px 15px',
                      borderRadius: '18px',
                      fontStyle: 'italic'
                    }}>
                      Thinking...
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        gap: '10px',
        backgroundColor: 'white',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me about syncing your tasks..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '12px',
            border: '1px solid #ced4da',
            borderRadius: '20px',
            fontSize: '16px',
            outline: 'none'
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '12px 24px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '20px',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !input.trim() ? 0.6 : 1,
            fontSize: '16px'
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}