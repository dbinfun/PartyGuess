import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from './theme';
import { createRoom } from './api';

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('adminKey') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  const handleCreate = async () => {
    if (!adminKey.trim()) { setError('请输入 Admin Key'); return; }
    setError('');
    setLoading(true);
    try {
      localStorage.setItem('adminKey', adminKey);
      const { roomId, secret } = await createRoom(adminKey);
      sessionStorage.setItem(`secret_${roomId}`, secret);
      navigate(`/admin/room/${roomId}`);
    } catch (e: any) {
      setError(e.message || '创建房间失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrap}>
      {/* Theme toggle */}
      <button onClick={toggle} style={styles.themeBtn} aria-label="切换主题">
        {theme === 'light' ? '🌙' : '☀️'}
      </button>

      <div style={styles.card}>
        <div style={styles.icon}>📣</div>
        <h1 style={styles.title}>抢答系统</h1>
        <p style={styles.sub}>管理员入口</p>

        <input
          type="password"
          placeholder="Admin Key"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          autoFocus
          style={styles.input}
        />

        {error && <p style={styles.error}>{error}</p>}

        <button onClick={handleCreate} disabled={loading} style={{
          ...styles.btn,
          opacity: loading ? 0.6 : 1,
          transform: loading ? 'scale(0.98)' : 'scale(1)',
        }}>
          {loading ? '创建中...' : '创建房间'}
        </button>

        <p style={styles.hint}>
          输入 Admin Key 创建抢答房间
        </p>
      </div>
    </div>
  );
}

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', background: 'var(--bg-primary)', padding: 24,
    transition: 'background var(--transition)',
  },
  themeBtn: {
    position: 'fixed', top: 20, right: 20,
    width: 40, height: 40, borderRadius: '50%',
    border: '1px solid var(--border-strong)',
    background: 'var(--glass-bg)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  card: {
    width: '100%', maxWidth: 400, padding: 48,
    background: 'var(--bg-secondary)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-lg)',
    border: '1px solid var(--border)',
    textAlign: 'center',
    transition: 'all var(--transition)',
  },
  icon: { fontSize: 48, marginBottom: 16 },
  title: {
    fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em',
    color: 'var(--text-primary)', marginBottom: 4,
  },
  sub: {
    fontSize: 15, color: 'var(--text-secondary)', marginBottom: 32,
  },
  input: {
    width: '100%', padding: '14px 18px', fontSize: 16,
    border: '1.5px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    outline: 'none', background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    textAlign: 'center', marginBottom: 16,
  },
  error: {
    color: 'var(--danger)', fontSize: 13, marginBottom: 12,
  },
  btn: {
    width: '100%', padding: '14px 0', fontSize: 17, fontWeight: 600,
    color: '#fff', background: 'var(--accent)',
    border: 'none', borderRadius: 999,
    cursor: 'pointer',
  },
  hint: {
    marginTop: 20, fontSize: 13, color: 'var(--text-tertiary)',
  },
};
