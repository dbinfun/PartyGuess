import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useTheme } from './theme';
import { BuzzerEntry, PlayerInfo, connectAdmin, clearBuzzers } from './api';

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
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.card} onClick={(e) => e.stopPropagation()}>
        <canvas ref={canvasRef} />
        <p style={modal.url}>{url}</p>
        <button style={modal.btn} onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

const modal: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  card: { background: '#fff', borderRadius: 24, padding: 32, textAlign: 'center', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  url: { marginTop: 16, color: '#333', fontSize: 12, wordBreak: 'break-all', fontFamily: 'var(--font-mono)' },
  btn: { marginTop: 16, padding: '10px 36px', border: 'none', borderRadius: 999, background: '#0071e3', color: '#fff', fontSize: 15, fontWeight: 500, cursor: 'pointer' },
};

// ============================================================
// 玩家列表弹窗
// ============================================================

function PlayersModal({ players, onClose }: { players: PlayerInfo[]; onClose: () => void }) {
  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={{ ...modal.card, minWidth: 300 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#333' }}>👥 已加入玩家</h3>
        <p style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>当前 {players.length} 人在线</p>

        {players.length === 0 ? (
          <p style={{ color: '#bbb', fontSize: 14, padding: 20 }}>暂无玩家加入</p>
        ) : (
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {players.map((p, i) => (
              <div key={p.userId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', marginBottom: 4,
                background: '#f5f5f7', borderRadius: 12, fontSize: 14, color: '#333',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', lineHeight: '26px',
                    textAlign: 'center', fontSize: 11, fontWeight: 700,
                    background: '#0071e3', color: '#fff',
                  }}>{i + 1}</div>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                </div>
                <span style={{ fontSize: 11, color: '#999', fontFamily: 'var(--font-mono)' }}>
                  {new Date(p.joinAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <button style={modal.btn} onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

// ============================================================
// 倒计时 Hook（支持暂停/继续/停止）
// ============================================================

const TIMER_OPTIONS = [15, 30, 45, 60, 90];

interface TimerState {
  seconds: number;
  active: number | null;    // 选中的时长按钮
  running: boolean;         // 正在倒计时
  paused: boolean;          // 已暂停
}

function useTimer(onCountdownChange: (active: boolean) => void) {
  const [st, setSt] = useState<TimerState>({ seconds: 0, active: null, running: false, paused: false });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  // start: 开始或重新开始倒计时
  const start = useCallback((sec: number) => {
    clearTimer();
    setSt({ seconds: sec, active: sec, running: true, paused: false });
    onCountdownChange(true);
    intervalRef.current = setInterval(() => {
      setSt((prev) => {
        if (prev.paused) return prev; // 暂停中不减少
        if (prev.seconds <= 1) {
          clearTimer();
          const next: TimerState = { seconds: 0, active: null, running: false, paused: false };
          setTimeout(() => onCountdownChange(false), 0);
          return next;
        }
        return { ...prev, seconds: prev.seconds - 1 };
      });
    }, 1000);
  }, [clearTimer, onCountdownChange]);

  // pause: 暂停倒计时（抢答窗口保持打开）
  const pause = useCallback(() => {
    setSt((prev) => {
      if (!prev.running || prev.paused) return prev;
      return { ...prev, paused: true };
    });
  }, []);

  // resume: 从暂停恢复
  const resume = useCallback(() => {
    setSt((prev) => {
      if (!prev.running || !prev.paused) return prev;
      return { ...prev, paused: false };
    });
  }, []);

  // stop: 停止并复位（关闭抢答窗口）
  const stop = useCallback(() => {
    clearTimer();
    setSt({ seconds: 0, active: null, running: false, paused: false });
    onCountdownChange(false);
  }, [clearTimer, onCountdownChange]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { ...st, start, pause, resume, stop };
}

// ============================================================
// 摄像头 Hook
// ============================================================

function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hasCam, setHasCam] = useState(false);
  const [err, setErr] = useState('');

  // 获取摄像头流
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setErr('摄像头需要 HTTPS 或 localhost'); return; }
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 3840, min: 640 },
        height: { ideal: 2160, min: 480 },
        frameRate: { ideal: 30 },
      },
      audio: false, // 不采集音频
    })
      .then((stream) => { streamRef.current = stream; setHasCam(true); })
      .catch((e) => setErr(e.message || '无法访问摄像头'));
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // 当 video 元素渲染到 DOM 后再绑定 srcObject 并播放
  useEffect(() => {
    if (!hasCam || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.play().catch(() => { /* 浏览器可能阻止自动播放 */ });
  }, [hasCam]);

  return { videoRef, hasCam, err };
}

// ============================================================
// 画布渲染 Hook（接收笔画并在 canvas 上绘制）
// ============================================================

function useDrawCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const wRef = useRef(0);
  const hRef = useRef(0);

  // 初始化 + 自适应大小
  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;
    wRef.current = w;
    hRef.current = h;

    // 白色背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }, []);

  useEffect(() => {
    setup();
    const onResize = () => setup();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setup]);

  const drawStroke = useCallback((points: { x: number; y: number }[], color: string, size: number) => {
    const ctx = ctxRef.current;
    const w = wRef.current;
    const h = hRef.current;
    if (!ctx || points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(points[0].x * w, points[0].y * h);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * w, points[i].y * h);
    }
    ctx.stroke();
  }, []);

  const clearCanvas = useCallback(() => {
    const ctx = ctxRef.current;
    const w = wRef.current;
    const h = hRef.current;
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }, []);

  // 回放全部历史笔画（服务端重连时使用）
  const replayAll = useCallback((strokes: any[]) => {
    const ctx = ctxRef.current;
    const w = wRef.current;
    const h = hRef.current;
    if (!ctx) return;
    // 先清空
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // 逐笔画回放
    for (const s of strokes) {
      const points = s.points || [];
      if (points.length < 2) continue;
      ctx.strokeStyle = s.color || '#000000';
      ctx.lineWidth = s.size || 4;
      ctx.beginPath();
      ctx.moveTo(points[0].x * w, points[0].y * h);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * w, points[i].y * h);
      }
      ctx.stroke();
    }
  }, []);

  // 初始化时画白背景
  useEffect(() => {
    const timer = setTimeout(() => setup(), 100); // 延迟确保 DOM 就绪
    return () => clearTimeout(timer);
  }, [setup]);

  return { canvasRef, drawStroke, clearCanvas, setup, replayAll };
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
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [showQR, setShowQR] = useState(false);
  const [showDrawQR, setShowDrawQR] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [viewMode, setViewMode] = useState<'camera' | 'canvas'>('camera');
  const [wsSend, setWsSend] = useState<((active: boolean) => void) | null>(null);

  const camera = useCamera();
  const drawCanvas = useDrawCanvas();

  const handleCountdownChange = useCallback((active: boolean) => {
    if (wsSend) wsSend(active);
  }, [wsSend]);

  const timer = useTimer(handleCountdownChange);
  const playUrl = `${location.protocol}//${location.host}/play/${roomId}?secret=${secret}`;
  const drawUrl = `${location.protocol}//${location.host}/draw/${roomId}?secret=${secret}`;

  // WebSocket
  useEffect(() => {
    if (!roomId || !secret) return;
    const { sendCountdown, close } = connectAdmin(roomId, secret, {
      onUpdate: (list, plist) => { setBuzzers(list); setPlayers(plist); },
      onState: (list, plist, cdActive) => {
        setBuzzers(list);
        setPlayers(plist);
        if (!cdActive && timer.running) timer.stop();
      },
      onStroke: (points, color, size) => {
        drawCanvas.drawStroke(points, color, size);
      },
      onClearCanvas: () => {
        drawCanvas.clearCanvas();
      },
      onReplay: (strokes) => {
        drawCanvas.replayAll(strokes);
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

  const isTimerActive = timer.running;

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
            <button key={sec} style={timerBtnCss(timer.active === sec && !timer.paused)}
              onClick={() => timer.start(sec)} disabled={isTimerActive}>
              {sec}s
            </button>
          ))}
        </div>

        {/* 倒计时显示 */}
        <div style={S.timerDisplay}>
          <span style={{
            fontSize: 48, fontWeight: timer.paused ? 600 : 700,
            color: timer.paused ? 'var(--warning)' : 'var(--text-primary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {timer.running ? timer.seconds : '--'}
          </span>
          <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: 4 }}>
            {timer.running ? (timer.paused ? '⏸' : 's') : ''}
          </span>
        </div>

        {/* 暂停 / 继续 / 停止 —— 暂停是主按钮 */}
        {isTimerActive ? (
          <div style={S.actionRow}>
            {timer.paused ? (
              <button style={S.btnPrimary} onClick={timer.resume}>▶ 继续</button>
            ) : (
              <button style={S.btnWarning} onClick={timer.pause}>⏸ 暂停</button>
            )}
            <button style={S.btnDanger} onClick={timer.stop}>■ 停止</button>
          </div>
        ) : (
          <div style={S.actionRow}>
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
              点击上方时长开始
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div style={{ ...S.actionRow, paddingTop: 4 }}>
          <button style={S.btnSecondary} onClick={() => setShowQR(true)}>📱 抢答码</button>
          <button style={S.btnSecondary} onClick={() => setShowDrawQR(true)}>🎨 画布码</button>
        </div>
        <div style={{ ...S.actionRow, paddingTop: 0 }}>
          <button style={S.btnSecondary} onClick={() => setShowPlayers(true)}>👥 在线 ({players.length})</button>
          <button style={S.btnDangerOutline} onClick={handleClear}>🗑 清空</button>
        </div>

        {/* 画布模式切换 */}
        <div style={{ padding: '0 20px 8px' }}>
          <div style={{
            display: 'flex', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', padding: 3,
          }}>
            <button onClick={() => setViewMode('camera')} style={modeToggleCss(viewMode === 'camera')}>
              📷 摄像
            </button>
            <button onClick={() => { setViewMode('canvas'); setTimeout(() => drawCanvas.setup(), 50); }} style={modeToggleCss(viewMode === 'canvas')}>
              🎨 画布
            </button>
          </div>
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

      {/* ---- 主区域 ---- */}
      <div style={S.main}>
        {/* 摄像头 — 始终渲染，避免切换时 srcObject 丢失 */}
        <div style={{ ...S.videoArea, display: viewMode === 'camera' ? 'flex' : 'none' }}>
          {camera.hasCam ? (
            <video ref={camera.videoRef} style={S.video} autoPlay muted playsInline />
          ) : (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 16 }}>
              {camera.err || '📷 摄像头未授权'}
            </div>
          )}
        </div>
        {/* 画布 — 始终渲染，保留绘制内容且支持 replay */}
        <div style={{ ...S.videoArea, background: '#e8e8ed', display: viewMode === 'canvas' ? 'flex' : 'none' }}>
          <canvas ref={drawCanvas.canvasRef} style={{ width: '100%', height: '100%' }} />
        </div>
        {timer.running && (
          <div style={{
            position: 'absolute', top: 20, right: 20,
            padding: timer.paused ? '12px 24px' : '10px 28px',
            borderRadius: 999,
            background: timer.paused ? 'rgba(255,159,10,0.9)' : 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            color: '#fff', fontSize: timer.paused ? 20 : 36,
            fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.2,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            pointerEvents: 'none', zIndex: 10,
          }}>
            {timer.paused ? '⏸ 暂停' : timer.seconds + 's'}
          </div>
        )}
      </div>

      {showQR && <QRModal url={playUrl} onClose={() => setShowQR(false)} />}
      {showDrawQR && <QRModal url={drawUrl} onClose={() => setShowDrawQR(false)} />}
      {showPlayers && <PlayersModal players={players} onClose={() => setShowPlayers(false)} />}
    </div>
  );
}

// ============================================================
// 样式
// ============================================================

const modeToggleCss = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600, textAlign: 'center',
  border: 'none', borderRadius: 8, cursor: 'pointer',
  background: active ? 'var(--bg-secondary)' : 'transparent',
  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
  boxShadow: active ? 'var(--shadow-sm)' : 'none',
});

const timerBtnCss = (active: boolean): React.CSSProperties => ({
  flex: '1 0 auto', padding: '8px 0', fontSize: 13, fontWeight: 600,
  border: active ? '2px solid var(--accent)' : '1.5px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  background: active ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
  color: active ? 'var(--accent)' : 'var(--text-secondary)',
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
  actionRow: { display: 'flex', gap: 8, padding: '12px 20px' },
  btnPrimary: {
    flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none',
    borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
  },
  btnWarning: {
    flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none',
    borderRadius: 'var(--radius-sm)', background: 'var(--warning)', color: '#fff', cursor: 'pointer',
  },
  btnDanger: {
    flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none',
    borderRadius: 'var(--radius-sm)', background: 'var(--danger)', color: '#fff', cursor: 'pointer',
  },
  btnSecondary: {
    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: '1.5px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer',
  },
  btnDangerOutline: {
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
  main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#000', position: 'relative', overflow: 'hidden' },
  videoArea: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
};
