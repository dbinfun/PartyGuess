import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTheme } from './theme';
import { verifyRoom } from './api';

// ============================================================
// 连线 WebSocket（画手角色）
// ============================================================

interface StrokePoint { x: number; y: number; } // 0~1 归一化坐标

function connectDrawer(roomId: string) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/room?roomId=${roomId}&role=drawer&secret=` +
    new URLSearchParams(location.search).get('secret') || '');

  return {
    sendStroke: (points: StrokePoint[], color: string, size: number, tool: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stroke', points, color, size, tool }));
      }
    },
    sendClear: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clearCanvas' }));
      }
    },
    close: () => ws.close(),
  };
}

// ============================================================
// 主组件
// ============================================================

const COLORS = ['#000000', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de'];
const SIZES = [2, 4, 6, 10, 16, 24];

export default function DrawPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const secret = searchParams.get('secret') || '';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<ReturnType<typeof connectDrawer> | null>(null);
  const drawingRef = useRef(false);
  const lastSentRef = useRef(0);
  const pendingRef = useRef<StrokePoint[]>([]);

  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(4);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [verifying, setVerifying] = useState(true);
  const [roomValid, setRoomValid] = useState(false);

  // 验证房间
  useEffect(() => {
    if (!roomId || !secret) { setVerifying(false); return; }
    verifyRoom(roomId, secret).then(setRoomValid).finally(() => setVerifying(false));
  }, [roomId, secret]);

  // 连接 WebSocket
  useEffect(() => {
    if (!roomValid) return;
    wsRef.current = connectDrawer(roomId!);
    return () => wsRef.current?.close();
  }, [roomValid, roomId]);

  // ---- 画布设置 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.parentElement!.clientWidth;
      const h = canvas.parentElement!.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [roomValid]);

  // ---- 绘制 & 发送 ----
  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0 || !wsRef.current) return;
    wsRef.current.sendStroke(pendingRef.current, tool === 'eraser' ? '#ffffff' : color, size, tool);
    pendingRef.current = [];
  }, [color, size, tool]);

  const getPos = (e: React.PointerEvent): StrokePoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const localDraw = (points: StrokePoint[], c: string, s: number) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.strokeStyle = c;
    ctx.lineWidth = s;
    ctx.beginPath();
    ctx.moveTo(points[0].x * w, points[0].y * h);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * w, points[i].y * h);
    }
    ctx.stroke();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drawingRef.current = true;
    const pt = getPos(e);
    pendingRef.current = [pt];
    lastSentRef.current = Date.now();

    // 本地画一个点
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const c = tool === 'eraser' ? '#ffffff' : color;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, size / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const pt = getPos(e);
    const prev = pendingRef.current[pendingRef.current.length - 1];
    pendingRef.current.push(pt);

    // 本地画线
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const c = tool === 'eraser' ? '#ffffff' : color;
    ctx.strokeStyle = c;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(prev.x * w, prev.y * h);
    ctx.lineTo(pt.x * w, pt.y * h);
    ctx.stroke();

    // 每 40ms 批量发送一次，减少流量
    const now = Date.now();
    if (now - lastSentRef.current > 40) {
      flushPending();
      lastSentRef.current = now;
    }
  };

  const onPointerUp = () => {
    drawingRef.current = false;
    flushPending();
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);
    wsRef.current?.sendClear();
  };

  // ---- 状态渲染 ----
  if (verifying) return <CenterMsg emoji="⏳" text="验证中..." />;
  if (!roomValid) return <CenterMsg emoji="❌" text="房间无效">
    <button style={btnCss} onClick={() => navigate('/admin')}>返回</button>
  </CenterMsg>;

  return (
    <div style={S.wrap}>
      {/* 顶栏 */}
      <div style={S.topBar}>
        <button onClick={toggleTheme} style={S.topBtn}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>🎨 画布</span>
        <button onClick={handleClear} style={{ ...S.topBtn, color: 'var(--danger)' }}>🗑</button>
      </div>

      {/* 画布 */}
      <div style={S.canvasWrap}>
        <canvas ref={canvasRef}
          style={{ touchAction: 'none', background: '#fff', borderRadius: 12 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {/* 工具栏 */}
      <div style={S.toolbar}>
        {/* 工具切换 */}
        <div style={S.toolRow}>
          <button onClick={() => setTool('pen')} style={toolBtnCss(tool === 'pen')}>✏️</button>
          <button onClick={() => setTool('eraser')} style={toolBtnCss(tool === 'eraser')}>🧹</button>
          <div style={{ width: 1, height: 24, background: 'var(--border-strong)', margin: '0 8px' }} />
          {/* 颜色 */}
          {COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); setTool('pen'); }}
              style={{
                ...S.colorSwatch,
                background: c,
                border: color === c && tool === 'pen' ? '3px solid var(--accent)' : '2px solid var(--border-strong)',
                boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #ddd' : 'none',
              }}
            />
          ))}
        </div>

        {/* 粗细 */}
        <div style={S.sizeRow}>
          {SIZES.map((s) => (
            <button key={s} onClick={() => setSize(s)}
              style={{
                ...S.sizeBtn,
                background: size === s ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: size === s ? '#fff' : 'var(--text-secondary)',
              }}>
              <span style={{
                display: 'inline-block', width: s, height: s, borderRadius: '50%',
                background: size === s ? '#fff' : 'var(--text-primary)',
              }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- 小组件 ----

function CenterMsg({ emoji, text, children }: { emoji: string; text: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)', gap: 16 }}>
      <div style={{ fontSize: 48 }}>{emoji}</div>
      <p style={{ fontSize: 17, color: 'var(--text-secondary)' }}>{text}</p>
      {children}
    </div>
  );
}

// ---- 样式 ----

const btnCss: React.CSSProperties = {
  padding: '10px 28px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 999, background: 'var(--accent)', color: '#fff', cursor: 'pointer',
};

const toolBtnCss = (active: boolean): React.CSSProperties => ({
  width: 40, height: 40, fontSize: 18, border: active ? '2px solid var(--accent)' : '1.5px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', background: active ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
});

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-primary)' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' },
  topBtn: { width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border-strong)', background: 'var(--bg-tertiary)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  canvasWrap: { flex: 1, margin: 12, overflow: 'hidden', borderRadius: 12, border: '1px solid var(--border)' },
  toolbar: { padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' },
  toolRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  colorSwatch: { width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', flexShrink: 0 },
  sizeRow: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' },
  sizeBtn: { width: 42, height: 42, borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
};
