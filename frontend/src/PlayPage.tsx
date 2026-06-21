import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { connectPlayer, verifyRoom } from './api';

// ---- 样式 ----

const wrapStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  height: '100vh', background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#fff',
};

const titleStyle: React.CSSProperties = { fontSize: 28, fontWeight: 700, marginBottom: 8 };
const subtitleStyle: React.CSSProperties = { fontSize: 14, color: '#aaa', marginBottom: 32 };
const inputStyle: React.CSSProperties = {
  width: 260, padding: '14px 18px', fontSize: 16, border: '2px solid rgba(255,255,255,0.2)',
  borderRadius: 12, outline: 'none', background: 'rgba(255,255,255,0.08)', color: '#fff',
  marginBottom: 20, textAlign: 'center',
};

const buzzBtnStyle = (pressed: boolean): React.CSSProperties => ({
  width: 200, height: 200, borderRadius: '50%', border: '4px solid #e94560',
  background: pressed ? '#e94560' : 'rgba(233,68,96,0.15)',
  color: '#fff', fontSize: 22, fontWeight: 700, cursor: 'pointer',
  transition: 'all 0.15s',
  boxShadow: pressed ? '0 0 40px rgba(233,68,96,0.6)' : '0 0 20px rgba(233,68,96,0.2)',
});

const feedbackStyle: React.CSSProperties = { marginTop: 24, fontSize: 16, fontWeight: 600, minHeight: 24 };

// ---- 组件 ----

export default function PlayPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const secret = searchParams.get('secret') || '';

  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [buzzMsg, setBuzzMsg] = useState('');
  const [pressed, setPressed] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [roomValid, setRoomValid] = useState(false);

  const wsRef = useRef<{ sendBuzz: () => void; close: () => void } | null>(null);

  // 验证房间
  useEffect(() => {
    if (!roomId || !secret) {
      setVerifying(false);
      return;
    }
    verifyRoom(roomId, secret).then(setRoomValid).finally(() => setVerifying(false));
  }, [roomId, secret]);

  // 加入房间
  const handleJoin = () => {
    const n = name.trim();
    if (!n) return;
    setJoined(true);
    const ws = connectPlayer(
      roomId!, n,
      () => {},
      () => { setBuzzMsg('✅ 抢答成功！'); setPressed(false); },
    );
    wsRef.current = ws;
  };

  // 点击抢答
  const handleBuzz = () => {
    if (!wsRef.current || !joined) return;
    setPressed(true);
    wsRef.current.sendBuzz();
    setBuzzMsg('⏳ 已发送...');
  };

  // 清理
  useEffect(() => {
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  if (verifying) {
    return (
      <div style={wrapStyle}>
        <p style={{ fontSize: 18, color: '#aaa' }}>验证房间中...</p>
      </div>
    );
  }

  if (!roomValid) {
    return (
      <div style={wrapStyle}>
        <p style={{ fontSize: 20, color: '#e74c3c', marginBottom: 16 }}>❌ 房间无效或已过期</p>
        <button
          style={{ padding: '10px 24px', border: 'none', borderRadius: 8, background: '#667eea', color: '#fff', cursor: 'pointer', fontSize: 14 }}
          onClick={() => navigate('/admin')}
        >
          返回首页
        </button>
      </div>
    );
  }

  // 加入前 — 输入名字
  if (!joined) {
    return (
      <div style={wrapStyle}>
        <h1 style={titleStyle}>📣 抢答器</h1>
        <p style={subtitleStyle}>输入你的名字加入房间</p>
        <input
          style={inputStyle}
          placeholder="输入你的名字"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          autoFocus
        />
        <button
          style={{
            padding: '12px 48px', fontSize: 16, fontWeight: 600, border: 'none',
            borderRadius: 10, background: 'linear-gradient(135deg, #667eea, #764ba2)',
            color: '#fff', cursor: 'pointer',
          }}
          onClick={handleJoin}
          disabled={!name.trim()}
        >
          加入房间
        </button>
      </div>
    );
  }

  // 加入后 — 抢答界面
  return (
    <div style={wrapStyle}>
      <h1 style={titleStyle}>🙋 {name}</h1>
      <p style={subtitleStyle}>已加入房间，随时点击抢答！</p>

      <button style={buzzBtnStyle(pressed)} onClick={handleBuzz}>
        抢答
      </button>

      {buzzMsg && <div style={feedbackStyle}>{buzzMsg}</div>}
    </div>
  );
}
