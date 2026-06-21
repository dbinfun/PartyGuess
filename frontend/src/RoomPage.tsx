import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { BuzzerEntry, connectAdmin, clearBuzzers } from './api';

// ============================================================
// 样式
// ============================================================

const timerBtnStyle = (active: boolean): React.CSSProperties => ({
  flex: '1 0 auto', padding: '8px 0', fontSize: 13, fontWeight: 600,
  border: active ? '2px solid #e94560' : '2px solid #333',
  borderRadius: 6, cursor: 'pointer',
  background: active ? '#e94560' : 'transparent',
  color: active ? '#fff' : '#aaa',
  minWidth: 52, textAlign: 'center',
});

const buzzerRankStyle = (rank: number): React.CSSProperties => ({
  width: 26, height: 26, borderRadius: '50%', lineHeight: '26px', textAlign: 'center',
  fontSize: 12, fontWeight: 700, marginRight: 10,
  background: rank === 0 ? '#e94560' : rank === 1 ? '#f5a623' : rank === 2 ? '#2ecc71' : '#333',
  color: '#fff',
});

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  sidebar: { width: 320, background: '#1a1a2e', color: '#eee', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarTitle: { padding: '20px 20px 8px', fontSize: 18, fontWeight: 700, color: '#e94560' },
  sidebarSub: { padding: '0 20px 16px', fontSize: 12, color: '#666' },
  timerRow: { display: 'flex', gap: 6, padding: '0 20px 12px', flexWrap: 'wrap' as const },
  timerDisplay: { textAlign: 'center' as const, fontSize: 56, fontWeight: 800, color: '#e94560', padding: '8px 0', fontVariantNumeric: 'tabular-nums' as const },
  qrBtn: { margin: '0 20px 12px', padding: '10px 0', fontSize: 14, fontWeight: 600, border: '2px solid #0f3460', borderRadius: 8, cursor: 'pointer', background: '#0f3460', color: '#eee' },
  clearBtn: { margin: '0 20px 8px', padding: '10px 0', fontSize: 14, fontWeight: 600, border: '2px solid #e94560', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: '#e94560' },
  listWrap: { flex: 1, overflowY: 'auto' as const, padding: '0 20px 20px' },
  buzzerItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', marginBottom: 6, background: '#16213e', borderRadius: 8, fontSize: 14 },
  main: { flex: 1, display: 'flex', flexDirection: 'column' as const, background: '#0a0a0a' },
  videoArea: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' as const, overflow: 'hidden' },
  video: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const },
  videoOff: { color: '#444', fontSize: 20 },
};

// ============================================================
// QR 弹窗
// ============================================================

function QRModal({ url, onClose }: { url: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      QRCode.toCanvas(canvasRef.current, url, { width: 256, margin: 2 }, (err: any) => {
        if (err) console.error('QR error:', err);
      });
    } catch (e) {
      console.error('QR render failed:', e);
    }
  }, [url]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', maxWidth: 360 }}
        onClick={(e) => e.stopPropagation()}
      >
        <canvas ref={canvasRef} />
        <p style={{ marginTop: 16, color: '#333', fontSize: 13, wordBreak: 'break-all' }}>{url}</p>
        <button
          style={{ marginTop: 12, padding: '8px 32px', border: 'none', borderRadius: 8, background: '#667eea', color: '#fff', fontSize: 14, cursor: 'pointer' }}
          onClick={onClose}
        >
          关闭
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 倒计时 Hook（纯前端）
// ============================================================

const TIMER_OPTIONS = [15, 30, 45, 60, 90];

function useTimer() {
  const [seconds, setSeconds] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback((sec: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSeconds(sec);
    setActive(sec);
    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setActive(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSeconds(0);
    setActive(null);
  }, []);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  return { seconds, active, start, stop };
}

// ============================================================
// 摄像头 Hook（纯前端）
// ============================================================

function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    // HTTP 非安全上下文下 mediaDevices 可能不存在
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrMsg('摄像头需要 HTTPS 或 localhost');
      return;
    }

    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
        setHasCamera(true);
      })
      .catch((e) => {
        setErrMsg(e.message || '无法访问摄像头');
      });
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { videoRef, hasCamera, errMsg };
}

// ============================================================
// 主组件
// ============================================================

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const adminKey = localStorage.getItem('adminKey') || '';
  const secret = sessionStorage.getItem(`secret_${roomId}`) || '';

  const [buzzers, setBuzzers] = useState<BuzzerEntry[]>([]);
  const [showQR, setShowQR] = useState(false);
  const timer = useTimer();
  const camera = useCamera();

  // 房间 URL
  const playUrl = `${location.protocol}//${location.host}/play/${roomId}?secret=${secret}`;

  // WebSocket 连接
  useEffect(() => {
    if (!roomId || !secret) return;
    const close = connectAdmin(roomId, secret, (list) => setBuzzers(list));
    return close;
  }, [roomId, secret]);

  // 验证权限
  useEffect(() => {
    if (!roomId || !secret) {
      navigate('/admin', { replace: true });
    }
  }, [roomId, secret, navigate]);

  // 清空抢答
  const handleClear = async () => {
    if (!window.confirm('确认清空抢答列表？')) return;
    try {
      await clearBuzzers(roomId!, adminKey);
      setBuzzers([]);
    } catch {
      alert('清空失败');
    }
  };

  return (
    <div style={S.wrap}>
      {/* ---- 侧边栏 ---- */}
      <div style={S.sidebar}>
        <div style={S.sidebarTitle}>🎯 房间控制</div>
        <div style={S.sidebarSub}>Room: {roomId}</div>

        {/* 倒计时按钮 */}
        <div style={S.timerRow}>
          {TIMER_OPTIONS.map((sec) => (
            <button
              key={sec}
              style={timerBtnStyle(timer.active === sec)}
              onClick={() => timer.start(sec)}
            >
              {sec}s
            </button>
          ))}
          <button
            style={{ ...timerBtnStyle(false), borderColor: '#e94560', color: '#e94560' }}
            onClick={timer.stop}
          >
            停
          </button>
        </div>

        {/* 倒计时显示 */}
        <div style={S.timerDisplay}>{timer.seconds > 0 ? timer.seconds : '--'}</div>

        {/* 二维码按钮 */}
        <button style={S.qrBtn} onClick={() => setShowQR(true)}>
          📱 二维码 & 链接
        </button>

        {/* 清空按钮 */}
        <button style={S.clearBtn} onClick={handleClear}>
          🗑 清空抢答列表
        </button>

        {/* 抢答列表 */}
        <div style={S.listWrap}>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
            抢答列表 ({buzzers.length}/10)
          </p>
          {buzzers.length === 0 && (
            <p style={{ color: '#444', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              等待抢答...
            </p>
          )}
          {buzzers.map((b, i) => (
            <div key={`${b.userId}-${b.time}`} style={S.buzzerItem}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={buzzerRankStyle(i)}>{i + 1}</div>
                <span>{b.name}</span>
              </div>
              <span style={{ color: '#888', fontSize: 12 }}>
                {new Date(b.time).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ---- 主区域：摄像头 ---- */}
      <div style={S.main}>
        <div style={S.videoArea}>
          {camera.hasCamera ? (
            <video ref={camera.videoRef} style={S.video} autoPlay muted playsInline />
          ) : (
            <div style={S.videoOff}>
              {camera.errMsg || '📷 摄像头未授权'}
            </div>
          )}
        </div>
      </div>

      {/* QR 弹窗 */}
      {showQR && <QRModal url={playUrl} onClose={() => setShowQR(false)} />}
    </div>
  );
}
