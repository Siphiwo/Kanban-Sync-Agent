import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { ErrorBoundary } from './components/ErrorBoundary';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Connections from './pages/Connections';
import Rules from './pages/Rules';
import Chat from './pages/Chat';

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Layout />}>
            <Route index element={
              <ErrorBoundary>
                <Dashboard />
              </ErrorBoundary>
            } />
            <Route path="connections" element={
              <ErrorBoundary>
                <Connections />
              </ErrorBoundary>
            } />
            <Route path="rules" element={
              <ErrorBoundary>
                <Rules />
              </ErrorBoundary>
            } />
            <Route path="chat" element={
              <ErrorBoundary>
                <Chat />
              </ErrorBoundary>
            } />
          </Route>
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;