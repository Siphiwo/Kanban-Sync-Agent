import React from 'react';
import { Outlet, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Layout() {
  const { user, logout } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <nav style={{
        width: '250px',
        backgroundColor: '#f8f9fa',
        padding: '20px',
        borderRight: '1px solid #dee2e6'
      }}>
        <h2 style={{ margin: '0 0 30px 0', color: '#495057' }}>KanbanSync</h2>
        
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          <li style={{ marginBottom: '10px' }}>
            <Link to="/" style={{ textDecoration: 'none', color: '#495057', display: 'block', padding: '10px' }}>
              Dashboard
            </Link>
          </li>
          <li style={{ marginBottom: '10px' }}>
            <Link to="/connections" style={{ textDecoration: 'none', color: '#495057', display: 'block', padding: '10px' }}>
              Connections
            </Link>
          </li>
          <li style={{ marginBottom: '10px' }}>
            <Link to="/rules" style={{ textDecoration: 'none', color: '#495057', display: 'block', padding: '10px' }}>
              Sync Rules
            </Link>
          </li>
          <li style={{ marginBottom: '10px' }}>
            <Link to="/chat" style={{ textDecoration: 'none', color: '#495057', display: 'block', padding: '10px' }}>
              Chat Assistant
            </Link>
          </li>
        </ul>

        <div style={{ position: 'absolute', bottom: '20px' }}>
          <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#6c757d' }}>
            {user.name}
          </p>
          <button 
            onClick={logout}
            style={{
              background: 'none',
              border: 'none',
              color: '#dc3545',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: '20px' }}>
        <Outlet />
      </main>
    </div>
  );
}