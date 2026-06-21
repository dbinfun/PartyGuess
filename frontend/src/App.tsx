import { Component } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AdminPage from './AdminPage';
import RoomPage from './RoomPage';
import PlayPage from './PlayPage';

// ---- Error Boundary：捕获渲染期崩溃，避免白屏 ----

interface EBState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', fontFamily: 'sans-serif', color: '#333', textAlign: 'center', padding: 20,
        }}>
          <h1 style={{ fontSize: 24, marginBottom: 12 }}>⚠️ 页面出错了</h1>
          <p style={{ color: '#e74c3c', fontSize: 14, maxWidth: 500, wordBreak: 'break-all' }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            style={{ marginTop: 20, padding: '10px 28px', border: 'none', borderRadius: 8, background: '#667eea', color: '#fff', cursor: 'pointer' }}
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/admin'; }}
          >
            返回首页
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---- 路由 ----

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/room/:roomId" element={<RoomPage />} />
        <Route path="/play/:roomId" element={<PlayPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
