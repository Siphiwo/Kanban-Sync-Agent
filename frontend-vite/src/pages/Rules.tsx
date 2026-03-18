import React, { useState, useEffect } from 'react';
import { rulesAPI, connectionsAPI, syncAPI } from '../services/api';
import { SyncRule, Connection, SyncLog } from '../types';

export default function Rules() {
  const [rules, setRules] = useState<SyncRule[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [rulesData, connectionsData] = await Promise.all([
        rulesAPI.getRules(),
        connectionsAPI.getConnections()
      ]);
      setRules(rulesData);
      setConnections(connectionsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this sync rule?')) {
      return;
    }

    try {
      await rulesAPI.deleteRule(id);
      setRules(rules.filter(rule => rule.id !== id));
    } catch (error) {
      console.error('Failed to delete rule:', error);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, color: '#495057' }}>Sync Rules</h1>
        {connections.length >= 2 && (
          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Create Rule
          </button>
        )}
      </div>

      {connections.length < 2 ? (
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <h3 style={{ color: '#495057' }}>Connect More Platforms</h3>
          <p style={{ color: '#6c757d' }}>
            You need at least 2 platform connections to create sync rules.
          </p>
        </div>
      ) : rules.length === 0 ? (
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <h3 style={{ color: '#495057' }}>No Sync Rules Yet</h3>
          <p style={{ color: '#6c757d', marginBottom: '20px' }}>
            Create your first sync rule to start automating task synchronization.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Create Your First Rule
          </button>
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
                  Rule Name
                </th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                  Source → Target
                </th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                  Status
                </th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                  Created
                </th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id}>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6', fontWeight: 'bold' }}>
                    {rule.name}
                  </td>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6', textTransform: 'capitalize' }}>
                    {rule.source_platform} → {rule.target_platform}
                  </td>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6' }}>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      backgroundColor: rule.is_active ? '#d4edda' : '#f8d7da',
                      color: rule.is_active ? '#155724' : '#721c24'
                    }}>
                      {rule.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6', color: '#6c757d' }}>
                    {new Date(rule.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '15px', borderBottom: '1px solid #dee2e6' }}>
                    <button
                      onClick={() => handleDelete(rule.id)}
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateForm && (
        <CreateRuleModal
          connections={connections}
          onClose={() => setShowCreateForm(false)}
          onSuccess={(newRule) => {
            setRules([...rules, newRule]);
            setShowCreateForm(false);
          }}
        />
      )}
    </div>
  );
}

function CreateRuleModal({ connections, onClose, onSuccess }: {
  connections: Connection[];
  onClose: () => void;
  onSuccess: (rule: SyncRule) => void;
}) {
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const rule = await rulesAPI.createRule({
        name,
        sourceConnectionId: sourceId,
        targetConnectionId: targetId
      });
      onSuccess(rule);
    } catch (error) {
      console.error('Failed to create rule:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '8px',
        width: '500px',
        maxWidth: '90vw'
      }}>
        <h3 style={{ marginTop: 0 }}>Create Sync Rule</h3>
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '4px'
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Source Platform</label>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '4px'
              }}
            >
              <option value="">Select source platform</option>
              {connections.map(conn => (
                <option key={conn.id} value={conn.id} style={{ textTransform: 'capitalize' }}>
                  {conn.platform}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Target Platform</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '4px'
              }}
            >
              <option value="">Select target platform</option>
              {connections.filter(conn => conn.id !== sourceId).map(conn => (
                <option key={conn.id} value={conn.id} style={{ textTransform: 'capitalize' }}>
                  {conn.platform}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '10px 20px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Creating...' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}