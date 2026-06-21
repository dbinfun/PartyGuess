import { Component } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme';
import AdminPage from './AdminPage';
import RoomPage from './RoomPage';
import PlayPage from './PlayPage';
import DrawPage from './DrawPage';

// ---- Error Boundary ----

interface EBState { hasError: boolean; error: Error | null; }

class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', fontFamily: 'var(--font-stack)', color: 'var(--text-primary)',
          background: 'var(--bg-primary)', textAlign: 'center', padding: 20,
        }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>⚠️ 页面出错了</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 480, wordBreak: 'break-all', marginBottom: 24 }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            style={{ padding: '10px 28px', border: 'none', borderRadius: 999, background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 500 }}
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

// ---- App ----

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/room/:roomId" element={<RoomPage />} />
          <Route path="/play/:roomId" element={<PlayPage />} />
          <Route path="/draw/:roomId" element={<DrawPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
