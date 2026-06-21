import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useTheme } from './theme';
import { BuzzerEntry, connectAdmin, clearBuzzers } from './api';

// ============================================================
// QR 弹窗
// ============================================================

function QRModal({ url, onClose }: { url: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 }, (err: any) => {
        if (err) console.error('QR:', err);
      });
    } catch (e) { console.error('QR:', e); }
  }, [url]);

  return (
    <div style={qrs.overlay} onClick={onClose}>
      <div style={qrs.card} onClick={(e) => e.stopPropagation()}>
        <canvas ref={canvasRef} />
        <p style={qrs.url}>{url}</p>
        <button style={qrs.btn} onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

const qrs: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  card: { background: '#fff', borderRadius: 24, padding: 32, textAlign: 'center', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  url: { marginTop: 16, color: '#333', fontSize: 12, wordBreak: 'break-all', fontFamily: 'var(--font-mono)' },
  btn: { marginTop: 16, padding: '10px 36px', border: 'none', borderRadius: 999, background: '#0071e3', color: '#fff', fontSize: 15, fontWeight: 500, cursor: 'pointer' },
};

// ============================================================
// 倒计时 Hook
// ============================================================

const TIMER_OPTIONS = [15, 30, 45, 60, 90];

function useTimer(onCountdownChange: (active: boolean) => void) {
  const [seconds, setSeconds] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback((sec: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSeconds(sec);
    setActive(sec);
    onCountdownChange(true);
    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setActive(null);
          onCountdownChange(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [onCountdownChange]);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSeconds(0);
    setActive(null);
    onCountdownChange(false);
  }, [onCountdownChange]);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  return { seconds, active, start, stop };
}

// ============================================================
// 摄像头 Hook
// ============================================================

function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasCam, setHasCam] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setErr('摄像头需要 HTTPS 或 localhost'); return; }
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; setHasCam(true); })
      .catch((e) => setErr(e.message || '无法访问摄像头'));
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []);

  return { videoRef, hasCam, err };
}

// ============================================================
// 主组件
// ============================================================

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const adminKey = localStorage.getItem('adminKey') || '';
  const secret = sessionStorage.getItem(`secret_${roomId}`) || '';

  const [buzzers, setBuzzers] = useState<BuzzerEntry[]>([]);
  const [showQR, setShowQR] = useState(false);
  const [wsSend, setWsSend] = useState<((active: boolean) => void) | null>(null);

  const camera = useCamera();

  // 倒计时 → WebSocket 通知后端
  const handleCountdownChange = useCallback((active: boolean) => {
    if (wsSend) wsSend(active);
  }, [wsSend]);

  const timer = useTimer(handleCountdownChange);

  const playUrl = `${location.protocol}//${location.host}/play/${roomId}?secret=${secret}`;

  // WebSocket
  useEffect(() => {
    if (!roomId || !secret) return;
    const { sendCountdown, close } = connectAdmin(roomId, secret, {
      onUpdate: (list) => setBuzzers(list),
      onState: (list, cdActive) => {
        setBuzzers(list);
        // 如果后端倒计时状态与本地不一致（如页面刷新），同步
        if (!cdActive && timer.active !== null) {
          timer.stop();
        }
      },
    });
    setWsSend(() => sendCountdown);
    return close;
  }, [roomId, secret]);

  // 权限守卫
  useEffect(() => {
    if (!roomId || !secret) navigate('/admin', { replace: true });
  }, [roomId, secret, navigate]);

  const handleClear = async () => {
    if (!window.confirm('确认清空抢答列表？')) return;
    try { await clearBuzzers(roomId!, adminKey); setBuzzers([]); } catch { alert('清空失败'); }
  };

  return (
    <div style={S.wrap}>
      {/* ---- 侧边栏 ---- */}
      <div style={S.sidebar}>
        <div style={S.header}>
          <div>
            <div style={S.title}>🎯 房间控制</div>
            <div style={S.roomId}>Room: {roomId}</div>
          </div>
          <button onClick={toggleTheme} style={S.themeBtn} aria-label="切换主题">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>

        {/* 倒计时 */}
        <div style={S.sectionLabel}>倒计时</div>
        <div style={S.timerRow}>
          {TIMER_OPTIONS.map((sec) => (
            <button key={sec} style={timerBtnCss(timer.active === sec)}
              onClick={() => timer.start(sec)}>{sec}s</button>
          ))}
          <button style={timerBtnCss(false, true)} onClick={timer.stop}>■</button>
        </div>
        <div style={S.timerDisplay}>
          <span style={{ fontSize: 48, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {timer.seconds > 0 ? timer.seconds : '--'}
          </span>
          <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: 4 }}>
            {timer.seconds > 0 ? 's' : ''}
          </span>
        </div>

        {/* 操作按钮 */}
        <div style={S.actionRow}>
          <button style={S.btnPrimary} onClick={() => setShowQR(true)}>📱 二维码</button>
          <button style={S.btnDanger} onClick={handleClear}>🗑 清空列表</button>
        </div>

        {/* 抢答列表 */}
        <div style={S.listWrap}>
          <div style={S.sectionLabel}>抢答列表 · {buzzers.length}/10</div>
          {buzzers.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              等待抢答...
            </p>
          )}
          {buzzers.map((b, i) => (
            <div key={`${b.userId}-${b.time}`} style={S.buzzerItem}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={rankBadge(i)}>{i + 1}</div>
                <span style={{ fontWeight: 500 }}>{b.name}</span>
              </div>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                {new Date(b.time).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ---- 主区域：摄像头 ---- */}
      <div style={S.main}>
        <div style={S.videoArea}>
          {camera.hasCam ? (
            <video ref={camera.videoRef} style={S.video} autoPlay muted playsInline />
          ) : (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 16 }}>
              {camera.err || '📷 摄像头未授权'}
            </div>
          )}
        </div>
        {timer.seconds > 0 && (
          <div style={S.overlayTimer}>
            <span style={{ fontSize: 96, fontWeight: 800, color: '#fff', textShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>
              {timer.seconds}
            </span>
          </div>
        )}
      </div>

      {showQR && <QRModal url={playUrl} onClose={() => setShowQR(false)} />}
    </div>
  );
}

// ============================================================
// 样式
// ============================================================

const timerBtnCss = (active: boolean, danger = false): React.CSSProperties => ({
  flex: '1 0 auto', padding: '8px 0', fontSize: 13, fontWeight: 600,
  border: active ? '2px solid var(--accent)' : danger ? '2px solid var(--danger)' : '1.5px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  background: active ? 'var(--accent-dim)' : danger ? 'transparent' : 'var(--bg-tertiary)',
  color: active ? 'var(--accent)' : danger ? 'var(--danger)' : 'var(--text-secondary)',
  minWidth: 48, textAlign: 'center',
});

const rankBadge = (i: number): React.CSSProperties => ({
  width: 24, height: 24, borderRadius: '50%', lineHeight: '24px', textAlign: 'center',
  fontSize: 11, fontWeight: 700,
  background: i === 0 ? 'var(--accent)' : i === 1 ? 'var(--warning)' : i === 2 ? 'var(--success)' : 'var(--bg-tertiary)',
  color: i < 3 ? '#fff' : 'var(--text-secondary)',
});

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', height: '100vh', background: 'var(--bg-primary)', transition: 'background var(--transition)' },
  sidebar: {
    width: 320, display: 'flex', flexDirection: 'column',
    background: 'var(--glass-bg)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
    borderRight: '1px solid var(--border)', transition: 'all var(--transition)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '24px 20px 8px' },
  title: { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' },
  roomId: { fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginTop: 2 },
  themeBtn: {
    width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border-strong)',
    background: 'var(--bg-tertiary)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  sectionLabel: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', padding: '16px 20px 8px' },
  timerRow: { display: 'flex', gap: 6, padding: '0 20px', flexWrap: 'wrap' },
  timerDisplay: { textAlign: 'center', padding: '12px 0 4px', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' },
  actionRow: { display: 'flex', gap: 8, padding: '16px 20px' },
  btnPrimary: {
    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: 'none',
    borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
  },
  btnDanger: {
    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: '1.5px solid var(--danger)',
    borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer',
  },
  listWrap: { flex: 1, overflowY: 'auto', padding: '0 20px 20px' },
  buzzerItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', marginBottom: 6,
    background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)', fontSize: 14,
    transition: 'all var(--transition)',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#000', position: 'relative' },
  videoArea: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  video: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
  overlayTimer: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.35)', pointerEvents: 'none',
  },
};
