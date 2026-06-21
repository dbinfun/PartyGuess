import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from './api';

const containerStyle: React.CSSProperties = {
  maxWidth: 420,
  margin: '120px auto',
  padding: 40,
  textAlign: 'center',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  fontSize: 16,
  border: '2px solid #e0e0e0',
  borderRadius: 10,
  outline: 'none',
  marginBottom: 16,
};

const btnStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 0',
  fontSize: 18,
  fontWeight: 600,
  color: '#fff',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
};

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('adminKey') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!adminKey.trim()) {
      setError('请输入 Admin Key');
      return;
    }
    setError('');
    setLoading(true);
    try {
      localStorage.setItem('adminKey', adminKey);
      const { roomId, secret } = await createRoom(adminKey);
      // 存储 secret 到 sessionStorage，方便 RoomPage 读取
      sessionStorage.setItem(`secret_${roomId}`, secret);
      navigate(`/admin/room/${roomId}`);
    } catch (e: any) {
      setError(e.message || '创建房间失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={containerStyle}>
      <h1 style={{ marginBottom: 8, fontSize: 32 }}>📣 抢答系统</h1>
      <p style={{ color: '#888', marginBottom: 32 }}>管理员入口</p>

      <input
        style={inputStyle}
        type="password"
        placeholder="请输入 Admin Key"
        value={adminKey}
        onChange={(e) => setAdminKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
      />

      {error && (
        <p style={{ color: '#e74c3c', marginBottom: 12, fontSize: 14 }}>{error}</p>
      )}

      <button style={btnStyle} onClick={handleCreate} disabled={loading}>
        {loading ? '创建中...' : '创建房间'}
      </button>

      <p style={{ marginTop: 24, color: '#bbb', fontSize: 13 }}>
        输入 Admin Key 后点击按钮即可创建房间
      </p>
    </div>
  );
}
