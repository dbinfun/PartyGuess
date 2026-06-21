import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTheme } from './theme';
import { connectPlayer, verifyRoom } from './api';

export default function PlayPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const secret = searchParams.get('secret') || '';

  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [buzzMsg, setBuzzMsg] = useState('');
  const [buzzOk, setBuzzOk] = useState(true);
  const [pressed, setPressed] = useState(false);
  const [countdownActive, setCountdownActive] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [roomValid, setRoomValid] = useState(false);

  const wsRef = useRef<{ sendBuzz: () => void; close: () => void } | null>(null);

  // 验证房间
  useEffect(() => {
    if (!roomId || !secret) { setVerifying(false); return; }
    verifyRoom(roomId, secret).then(setRoomValid).finally(() => setVerifying(false));
  }, [roomId, secret]);

  // 加入
  const handleJoin = () => {
    const n = name.trim();
    if (!n) return;
    setJoined(true);
    const ws = connectPlayer(roomId!, n, {
      onJoined: () => {},
      onBuzzAck: (ok, err) => {
        setBuzzMsg(ok ? '✅ 抢答成功！' : `❌ ${err || '失败'}`);
        setBuzzOk(ok);
        setPressed(false);
      },
      onCountdown: (active) => setCountdownActive(active),
    });
    wsRef.current = ws;
  };

  const handleBuzz = () => {
    if (!wsRef.current || !joined || !countdownActive) return;
    setPressed(true);
    wsRef.current.sendBuzz();
    setBuzzMsg('⏳ 已发送...');
  };

  useEffect(() => () => { if (wsRef.current) wsRef.current.close(); }, []);

  // ---- 状态渲染 ----

  if (verifying) {
    return <CenterMsg emoji="⏳" text="验证房间中..." />;
  }
  if (!roomValid) {
    return (
      <CenterMsg emoji="❌" text="房间无效或已过期">
        <button style={btnStyle} onClick={() => navigate('/admin')}>返回首页</button>
      </CenterMsg>
    );
  }

  // 未加入 — 输入名字
  if (!joined) {
    return (
      <div style={S.wrap}>
        <button onClick={toggle} style={S.themeBtn}>{theme === 'light' ? '🌙' : '☀️'}</button>
        <div style={S.card}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📣</div>
          <h1 style={S.title}>加入抢答</h1>
          <p style={S.sub}>输入你的名字参与抢答</p>
          <input style={S.input} placeholder="你的名字" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            autoFocus
          />
          <button style={{ ...btnStyle, width: '100%', opacity: name.trim() ? 1 : 0.4 }}
            onClick={handleJoin} disabled={!name.trim()}>
            加入房间
          </button>
        </div>
      </div>
    );
  }

  // 已加入 — 抢答
  const canBuzz = joined && countdownActive;

  return (
    <div style={S.wrap}>
      <button onClick={toggle} style={S.themeBtn}>{theme === 'light' ? '🌙' : '☀️'}</button>

      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>🙋 {name}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
          {countdownActive ? '🟢 抢答进行中 — 立即点击！' : '⏸ 等待倒计时开始'}
        </p>
      </div>

      <button
        onClick={handleBuzz}
        disabled={!canBuzz}
        style={{
          ...buzzBtnCss(pressed, canBuzz),
          opacity: canBuzz ? 1 : 0.35,
          cursor: canBuzz ? 'pointer' : 'not-allowed',
        }}
      >
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 2 }}>抢答</span>
      </button>

      {buzzMsg && (
        <p style={{
          marginTop: 20, fontSize: 15, fontWeight: 600,
          color: buzzOk ? 'var(--success)' : 'var(--danger)',
        }}>
          {buzzMsg}
        </p>
      )}
    </div>
  );
}

// ---- 小组件 ----

function CenterMsg({ emoji, text, children }: { emoji: string; text: string; children?: React.ReactNode }) {
  return (
    <div style={S.wrap}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{emoji}</div>
        <p style={{ fontSize: 17, color: 'var(--text-secondary)', marginBottom: 20 }}>{text}</p>
        {children}
      </div>
    </div>
  );
}

// ---- 样式 ----

const buzzBtnCss = (pressed: boolean, active: boolean): React.CSSProperties => ({
  width: 200, height: 200, borderRadius: '50%',
  border: '4px solid ' + (active ? 'var(--accent)' : 'var(--border-strong)'),
  background: pressed ? 'var(--accent)' : active ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
  color: pressed ? '#fff' : active ? 'var(--accent)' : 'var(--text-tertiary)',
  fontSize: 22, fontWeight: 700, cursor: 'pointer',
  transition: 'all 0.15s ease',
  boxShadow: active ? '0 0 48px ' + (pressed ? 'rgba(0,113,227,0.5)' : 'rgba(0,113,227,0.2)') : 'var(--shadow-md)',
});

const btnStyle: React.CSSProperties = {
  padding: '12px 32px', fontSize: 15, fontWeight: 600, border: 'none',
  borderRadius: 999, background: 'var(--accent)', color: '#fff', cursor: 'pointer',
};

const S: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 36, minHeight: '100vh', background: 'var(--bg-primary)', padding: 24,
    transition: 'background var(--transition)',
  },
  themeBtn: {
    position: 'fixed', top: 20, right: 20,
    width: 40, height: 40, borderRadius: '50%',
    border: '1px solid var(--border-strong)', background: 'var(--glass-bg)',
    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  card: {
    width: '100%', maxWidth: 380, padding: 40,
    background: 'var(--bg-secondary)', borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)',
    textAlign: 'center', transition: 'all var(--transition)',
  },
  title: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginBottom: 4 },
  sub: { fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 },
  input: {
    width: '100%', padding: '14px 18px', fontSize: 16, border: '1.5px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)', outline: 'none', background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)', textAlign: 'center', marginBottom: 16,
  },
};
