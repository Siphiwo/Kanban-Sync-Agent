import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { connectionsAPI, rulesAPI, statusAPI, syncAPI } from '../services/api';
import { Connection, SyncRule, StatusReport, SyncHistory, SyncStatistics } from '../types';

export default function Dashboard() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [rules, setRules] = useState<SyncRule[]>([]);
  const [statusReport, setStatusReport] = useState<StatusReport | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncHistory[]>([]);
  const [statistics, setStatistics] = useState<SyncStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
    
    // Set up auto-refresh every 30 seconds
    const interval = setInterval(() => {
      refreshData();
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [connectionsData, rulesData, reportData, historyData, statsData] = await Promise.all([
        connectionsAPI.getConnections(),
        rulesAPI.getRules(),
        statusAPI.getReport(),
        statusAPI.getSyncHistory(10),
        statusAPI.getStatistics(7)
      ]);
      
      setConnections(connectionsData);
      setRules(rulesData);
      setStatusReport(reportData);
      setSyncHistory(historyData);
      setStatistics(statsData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    setRefreshing(true);
    try {
      const [reportData, historyData, statsData] = await Promise.all([
        statusAPI.getReport(),
        statusAPI.getSyncHistory(10),
        statusAPI.getStatistics(7)
      ]);
      
      setStatusReport(reportData);
      setSyncHistory(historyData);
      setStatistics(statsData);
    } catch (error) {
      console.error('Failed to refresh dashboard data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleManualSync = async (ruleId: string) => {
    try {
      await syncAPI.executeRule(ruleId);
      // Refresh data after sync
      setTimeout(refreshData, 2000);
    } catch (error) {
      console.error('Manual sync failed:', error);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>Loading Dashboard...</div>
          <div style={{ color: '#6c757d' }}>Gathering sync data and status</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, color: '#495057' }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {refreshing && <span style={{ color: '#6c757d', fontSize: '14px' }}>Refreshing...</span>}
          <button
            onClick={refreshData}
            disabled={refreshing}
            style={{
              padding: '8px 16px',
              backgroundColor: '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? 0.6 : 1
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Status Overview Cards */}
      {statusReport && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          <StatusCard
            title="Active Rules"
            value={statusReport.sync_status.active_rules}
            total={statusReport.sync_status.total_rules}
            color="#007bff"
            icon="⚙️"
          />
          <StatusCard
            title="Today's Syncs"
            value={statusReport.sync_status.total_syncs_today}
            subtitle={`${Math.round(statusReport.sync_status.success_rate_today)}% success rate`}
            color="#28a745"
            icon="🔄"
          />
          <StatusCard
            title="Connected Platforms"
            value={connections.filter(c => c.is_active).length}
            total={connections.length}
            color="#6f42c1"
            icon="🔗"
          />
          <StatusCard
            title="Health Status"
            value={statusReport.connection_health.filter(c => c.status === 'healthy').length}
            total={statusReport.connection_health.length}
            subtitle="platforms healthy"
            color="#20c997"
            icon="💚"
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px', marginBottom: '30px' }}>
        {/* Recent Sync Activity */}
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ marginTop: 0, color: '#495057', display: 'flex', alignItems: 'center', gap: '10px' }}>
            📊 Recent Sync Activity
          </h3>
          {syncHistory.length === 0 ? (
            <p style={{ color: '#6c757d', textAlign: 'center', padding: '20px' }}>No sync activity yet</p>
          ) : (
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {syncHistory.map(sync => (
                <div key={sync.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 0',
                  borderBottom: '1px solid #dee2e6'
                }}>
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                      {sync.rule_name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6c757d' }}>
                      {sync.source_platform} → {sync.target_platform}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      backgroundColor: sync.status === 'success' ? '#d4edda' : 
                                     sync.status === 'error' ? '#f8d7da' : '#fff3cd',
                      color: sync.status === 'success' ? '#155724' : 
                             sync.status === 'error' ? '#721c24' : '#856404'
                    }}>
                      {sync.status}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '4px' }}>
                      {new Date(sync.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions & Alerts */}
        <div>
          {/* Error Alerts */}
          {statusReport && statusReport.recent_errors.length > 0 && (
            <div style={{
              backgroundColor: '#f8d7da',
              border: '1px solid #f5c6cb',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '20px'
            }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#721c24' }}>⚠️ Recent Errors</h4>
              {statusReport.recent_errors.slice(0, 3).map(error => (
                <div key={error.id} style={{ fontSize: '14px', marginBottom: '8px' }}>
                  <strong>{error.rule_name}:</strong> {error.error_message}
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {statusReport && statusReport.recommendations.length > 0 && (
            <div style={{
              backgroundColor: '#d1ecf1',
              border: '1px solid #bee5eb',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '20px'
            }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#0c5460' }}>💡 Recommendations</h4>
              {statusReport.recommendations.slice(0, 3).map((rec, index) => (
                <div key={index} style={{ fontSize: '14px', marginBottom: '8px' }}>
                  • {rec}
                </div>
              ))}
            </div>
          )}

          {/* Quick Actions */}
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h4 style={{ marginTop: 0, color: '#495057' }}>🚀 Quick Actions</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Link 
                to="/chat"
                style={{
                  display: 'block',
                  padding: '12px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}
              >
                💬 Chat Assistant
              </Link>
              {connections.length >= 2 && (
                <Link 
                  to="/rules"
                  style={{
                    display: 'block',
                    padding: '12px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    textDecoration: 'none',
                    borderRadius: '4px',
                    textAlign: 'center'
                  }}
                >
                  ⚙️ Manage Rules
                </Link>
              )}
              <Link 
                to="/connections"
                style={{
                  display: 'block',
                  padding: '12px',
                  backgroundColor: '#6f42c1',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}
              >
                🔗 Connections
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Sync Rules with Manual Trigger */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '30px'
      }}>
        <h3 style={{ marginTop: 0, color: '#495057' }}>⚙️ Sync Rules</h3>
        {rules.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <p style={{ color: '#6c757d' }}>No sync rules configured yet.</p>
            {connections.length >= 2 && (
              <Link 
                to="/rules"
                style={{
                  display: 'inline-block',
                  padding: '10px 20px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '4px'
                }}
              >
                Create Your First Rule
              </Link>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
            {rules.map(rule => (
              <div key={rule.id} style={{
                border: '1px solid #dee2e6',
                borderRadius: '6px',
                padding: '15px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, color: '#495057' }}>{rule.name}</h4>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '11px',
                    backgroundColor: rule.is_active ? '#d4edda' : '#f8d7da',
                    color: rule.is_active ? '#155724' : '#721c24'
                  }}>
                    {rule.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div style={{ fontSize: '14px', color: '#6c757d', marginBottom: '10px' }}>
                  {rule.source_platform} → {rule.target_platform}
                </div>
                <button
                  onClick={() => handleManualSync(rule.id)}
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
                  🔄 Manual Sync
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Statistics Chart */}
      {statistics && (
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ marginTop: 0, color: '#495057' }}>📈 7-Day Statistics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '20px', marginBottom: '20px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#007bff' }}>
                {statistics.total_syncs}
              </div>
              <div style={{ fontSize: '14px', color: '#6c757d' }}>Total Syncs</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>
                {Math.round(statistics.success_rate)}%
              </div>
              <div style={{ fontSize: '14px', color: '#6c757d' }}>Success Rate</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#17a2b8' }}>
                {statistics.avg_sync_time}ms
              </div>
              <div style={{ fontSize: '14px', color: '#6c757d' }}>Avg Sync Time</div>
            </div>
          </div>
          
          {/* Simple daily chart */}
          <div style={{ display: 'flex', alignItems: 'end', gap: '4px', height: '100px', padding: '10px 0' }}>
            {statistics.daily_stats.map((day, index) => (
              <div key={index} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  style={{
                    width: '100%',
                    backgroundColor: '#007bff',
                    opacity: 0.7,
                    height: `${Math.max(5, (day.syncs / Math.max(...statistics.daily_stats.map(d => d.syncs))) * 80)}px`,
                    marginBottom: '5px',
                    borderRadius: '2px'
                  }}
                  title={`${day.date}: ${day.syncs} syncs (${Math.round(day.success_rate)}% success)`}
                />
                <div style={{ fontSize: '10px', color: '#6c757d' }}>
                  {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({ title, value, total, subtitle, color, icon }: {
  title: string;
  value: number;
  total?: number;
  subtitle?: string;
  color: string;
  icon: string;
}) {
  return (
    <div style={{
      backgroundColor: 'white',
      padding: '20px',
      borderRadius: '8px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      borderLeft: `4px solid ${color}`
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '14px', color: '#6c757d', marginBottom: '5px' }}>
            {title}
          </div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#495057' }}>
            {value}{total && `/${total}`}
          </div>
          {subtitle && (
            <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '5px' }}>
              {subtitle}
            </div>
          )}
        </div>
        <div style={{ fontSize: '24px' }}>{icon}</div>
      </div>
    </div>
  );
}