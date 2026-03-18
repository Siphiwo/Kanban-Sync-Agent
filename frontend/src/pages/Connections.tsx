import React, { useState, useEffect } from 'react';
import { connectionsAPI, oauthAPI } from '../services/api';
import { Connection } from '../types';
import { useAuth } from '../hooks/useAuth';

export default function Connections() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [clickupToken, setClickupToken] = useState('');
  const [showClickupForm, setShowClickupForm] = useState(false);

  useEffect(() => {
    loadConnections();
    
    // Handle OAuth callback success/error
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    
    if (success) {
      setTimeout(() => {
        loadConnections();
        // Clear URL params
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 1000);
    }
    
    if (error) {
      console.error('OAuth error:', error);
      // Clear URL params
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const loadConnections = async () => {
    try {
      const data = await connectionsAPI.getConnections();
      setConnections(data);
    } catch (error) {
      console.error('Failed to load connections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (platform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira') => {
    if (!user) return;
    
    if (platform === 'clickup') {
      setShowClickupForm(true);
      return;
    }
    
    setConnecting(platform);
    
    try {
      let authUrl = '';
      
      if (platform === 'asana') {
        const response = await oauthAPI.getAsanaAuthUrl();
        authUrl = `${response.authUrl}&user_id=${user.id}`;
      } else if (platform === 'trello') {
        const response = await oauthAPI.getTrelloAuthUrl();
        authUrl = `${response.authUrl}#user_id=${user.id}`;
      } else if (platform === 'monday') {
        const response = await oauthAPI.getMondayAuthUrl();
        authUrl = `${response.authUrl}&user_id=${user.id}`;
      } else if (platform === 'jira') {
        const response = await oauthAPI.getJiraAuthUrl();
        authUrl = `${response.authUrl}&user_id=${user.id}`;
      }
      
      // Redirect to OAuth provider
      window.location.href = authUrl;
    } catch (error) {
      console.error(`Failed to connect to ${platform}:`, error);
      setConnecting(null);
    }
  };

  const handleClickupConnect = async () => {
    if (!clickupToken.trim()) {
      alert('Please enter your ClickUp API token');
      return;
    }

    setConnecting('clickup');
    
    try {
      await oauthAPI.connectClickup(clickupToken);
      setShowClickupForm(false);
      setClickupToken('');
      loadConnections();
    } catch (error) {
      console.error('Failed to connect to ClickUp:', error);
      alert('Failed to connect to ClickUp. Please check your API token.');
    } finally {
      setConnecting(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this connection?')) {
      return;
    }

    try {
      await connectionsAPI.deleteConnection(id);
      setConnections(connections.filter(conn => conn.id !== id));
    } catch (error) {
      console.error('Failed to delete connection:', error);
    }
  };

  const handleTest = async (id: string) => {
    try {
      const result = await connectionsAPI.testConnection(id);
      
      if (result.valid) {
        alert('Connection is working properly!');
        // Update connection status
        setConnections(connections.map(conn => 
          conn.id === id ? { ...conn, is_active: true } : conn
        ));
      } else {
        alert('Connection test failed. Please reconnect.');
        setConnections(connections.map(conn => 
          conn.id === id ? { ...conn, is_active: false } : conn
        ));
      }
    } catch (error) {
      console.error('Failed to test connection:', error);
      alert('Failed to test connection.');
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  const connectedPlatforms = connections.map(conn => conn.platform);
  const availablePlatforms = [
    { id: 'asana', name: 'Asana', color: '#f06a6a' },
    { id: 'trello', name: 'Trello', color: '#0079bf' },
    { id: 'monday', name: 'Monday.com', color: '#ff3d57' },
    { id: 'clickup', name: 'ClickUp', color: '#7b68ee' },
    { id: 'jira', name: 'Jira', color: '#0052cc' }
  ];

  return (
    <div>
      <h1 style={{ marginBottom: '30px', color: '#495057' }}>Platform Connections</h1>

      {/* Available Platforms */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '30px'
      }}>
        <h3 style={{ marginTop: 0, color: '#495057' }}>Connect New Platform</h3>
        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
          {availablePlatforms.map(platform => {
            const isConnected = connectedPlatforms.includes(platform.id as any);
            const isConnecting = connecting === platform.id;
            
            return (
              <button
                key={platform.id}
                onClick={() => !isConnected && handleConnect(platform.id as any)}
                disabled={isConnected || isConnecting}
                style={{
                  padding: '12px 24px',
                  backgroundColor: isConnected ? '#28a745' : platform.color,
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isConnected || isConnecting ? 'not-allowed' : 'pointer',
                  opacity: isConnected || isConnecting ? 0.7 : 1,
                  fontSize: '14px',
                  fontWeight: 'bold',
                  minWidth: '120px'
                }}
              >
                {isConnecting ? 'Connecting...' : 
                 isConnected ? `✓ ${platform.name}` : 
                 `Connect ${platform.name}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* ClickUp API Token Form */}
      {showClickupForm && (
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '30px',
          border: '2px solid #7b68ee'
        }}>
          <h3 style={{ marginTop: 0, color: '#495057' }}>Connect ClickUp</h3>
          <p style={{ color: '#6c757d', marginBottom: '15px' }}>
            Enter your ClickUp API token. You can find it in your ClickUp settings under "Apps".
          </p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="password"
              value={clickupToken}
              onChange={(e) => setClickupToken(e.target.value)}
              placeholder="Enter your ClickUp API token"
              style={{
                flex: 1,
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
            <button
              onClick={handleClickupConnect}
              disabled={connecting === 'clickup'}
              style={{
                padding: '10px 20px',
                backgroundColor: '#7b68ee',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: connecting === 'clickup' ? 'not-allowed' : 'pointer',
                fontSize: '14px'
              }}
            >
              {connecting === 'clickup' ? 'Connecting...' : 'Connect'}
            </button>
            <button
              onClick={() => {
                setShowClickupForm(false);
                setClickupToken('');
              }}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Connected Platforms */}
      {connections.length === 0 ? (
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <h3 style={{ color: '#495057' }}>No Connections Yet</h3>
          <p style={{ color: '#6c757d' }}>
            Connect your kanban platforms to start syncing tasks.
          </p>
        </div>
      ) : (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa' }}>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                  Platform
                </th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                  Status
                </th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                  Connected
                </th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {connections.map(connection => (
                <tr key={connection.id}>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        backgroundColor: availablePlatforms.find(p => p.id === connection.platform)?.color || '#6c757d'
                      }}></div>
                      <span style={{ textTransform: 'capitalize', fontWeight: 'bold' }}>
                        {availablePlatforms.find(p => p.id === connection.platform)?.name || connection.platform}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6' }}>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      backgroundColor: connection.is_active ? '#d4edda' : '#f8d7da',
                      color: connection.is_active ? '#155724' : '#721c24'
                    }}>
                      {connection.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6', color: '#6c757d' }}>
                    {new Date(connection.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => handleTest(connection.id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#17a2b8',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Test
                      </button>
                      <button
                        onClick={() => handleDelete(connection.id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#dc3545',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}