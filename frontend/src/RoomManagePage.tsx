import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from './theme';
import { listRooms, deleteRooms, shutdownServer, RoomSummary } from './api';

export default function RoomManagePage() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const adminKey = localStorage.getItem('adminKey') || '';

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(''); // 'delete-selected' | 'delete-all' | 'shutdown'

  const fetchRooms = useCallback(async () => {
    if (!adminKey) {
      setError('未找到 Admin Key，请先登录管理页面');
      setLoading(false);
      return;
    }
    try {
      setError('');
      const data = await listRooms(adminKey);
      setRooms(data.rooms);
    } catch (e: any) {
      setError(e.message || '获取房间列表失败');
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    fetchRooms();
    // 每 5 秒自动刷新
    const t = setInterval(fetchRooms, 5000);
    return () => clearInterval(t);
  }, [fetchRooms]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rooms.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rooms.map((r) => r.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确定要删除选中的 ${selected.size} 个房间吗？此操作不可撤销。`)) return;
    setActionLoading('delete-selected');
    try {
      await deleteRooms(adminKey, Array.from(selected));
      setSelected(new Set());
      await fetchRooms();
    } catch (e: any) {
      alert('删除失败: ' + (e.message || '未知错误'));
    } finally {
      setActionLoading('');
    }
  };

  const handleDeleteAll = async () => {
    if (rooms.length === 0) return;
    if (!window.confirm(`确定要删除全部 ${rooms.length} 个房间吗？此操作不可撤销。`)) return;
    if (!window.confirm('再次确认：删除后所有房间数据和画布内容将被永久清除。')) return;
    setActionLoading('delete-all');
    try {
      await deleteRooms(adminKey, null);
      setSelected(new Set());
      await fetchRooms();
    } catch (e: any) {
      alert('删除失败: ' + (e.message || '未知错误'));
    } finally {
      setActionLoading('');
    }
  };

  const handleShutdown = async () => {
    if (!window.confirm('⚠️ 确定要退出整个程序吗？\n\n这将关闭服务器，所有用户将断开连接。')) return;
    if (!window.confirm('⚠️ 最终确认：你确定要退出程序吗？')) return;
    setActionLoading('shutdown');
    try {
      await shutdownServer(adminKey);
      alert('服务器正在关闭...');
    } catch {
      // server may close connection before responding
      alert('服务器已关闭或无法响应');
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return (
    <div style={styles.wrap}>
      {/* Theme toggle */}
      <button onClick={toggle} style={styles.themeBtn} aria-label="切换主题">
        {theme === 'light' ? '🌙' : '☀️'}
      </button>

      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <button onClick={() => navigate('/admin')} style={styles.backBtn}>
            ← 返回
          </button>
          <h1 style={styles.title}>🛠️ 房间管理</h1>
          <span style={styles.count}>共 {rooms.length} 个房间</span>
        </div>

        {/* Error */}
        {error && <div style={styles.error}>{error}</div>}

        {/* Action bar */}
        <div style={styles.actionBar}>
          <button
            onClick={handleDeleteSelected}
            disabled={selected.size === 0 || actionLoading !== ''}
            style={{
              ...styles.actionBtn,
              ...styles.deleteBtn,
              opacity: selected.size === 0 || actionLoading !== '' ? 0.5 : 1,
            }}
          >
            {actionLoading === 'delete-selected' ? '删除中...' : `删除选中 (${selected.size})`}
          </button>
          <button
            onClick={handleDeleteAll}
            disabled={rooms.length === 0 || actionLoading !== ''}
            style={{
              ...styles.actionBtn,
              ...styles.deleteAllBtn,
              opacity: rooms.length === 0 || actionLoading !== '' ? 0.5 : 1,
            }}
          >
            {actionLoading === 'delete-all' ? '删除中...' : '清理全部'}
          </button>
          <button
            onClick={handleShutdown}
            disabled={actionLoading !== ''}
            style={{
              ...styles.actionBtn,
              ...styles.shutdownBtn,
              opacity: actionLoading !== '' ? 0.5 : 1,
            }}
          >
            {actionLoading === 'shutdown' ? '退出中...' : '⏻ 退出程序'}
          </button>
        </div>

        {/* Room list */}
        {loading ? (
          <div style={styles.empty}>加载中...</div>
        ) : rooms.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>📭</div>
            <div>当前没有房间</div>
            <div style={styles.emptyHint}>创建一个房间后刷新此页面</div>
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>
                    <input
                      type="checkbox"
                      checked={selected.size === rooms.length && rooms.length > 0}
                      onChange={toggleAll}
                      style={styles.checkbox}
                    />
                  </th>
                  <th style={styles.th}>房间 ID</th>
                  <th style={styles.th}>创建时间</th>
                  <th style={styles.th}>玩家</th>
                  <th style={styles.th}>抢答</th>
                  <th style={styles.th}>连接状态</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr
                    key={room.id}
                    style={{
                      ...styles.tr,
                      background: selected.has(room.id) ? 'var(--accent-transparent)' : 'transparent',
                    }}
                  >
                    <td style={styles.td}>
                      <input
                        type="checkbox"
                        checked={selected.has(room.id)}
                        onChange={() => toggleSelect(room.id)}
                        style={styles.checkbox}
                      />
                    </td>
                    <td style={{ ...styles.td, ...styles.mono }}>{room.id}</td>
                    <td style={styles.td}>{formatTime(room.createdAt)}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>{room.playerCount}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>{room.buzzerCount}</td>
                    <td style={styles.td}>
                      <span style={room.adminConnected ? styles.badgeOn : styles.badgeOff}>
                        管理
                      </span>{' '}
                      <span style={room.drawerConnected ? styles.badgeOn : styles.badgeOff}>
                        画布
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: '100vh',
    background: 'var(--bg-primary)',
    padding: 24,
    transition: 'background var(--transition)',
  },
  themeBtn: {
    position: 'fixed',
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: '1px solid var(--border-strong)',
    background: 'var(--glass-bg)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  container: {
    maxWidth: 960,
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  backBtn: {
    padding: '8px 16px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: 14,
    cursor: 'pointer',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
    flex: 1,
  },
  count: {
    fontSize: 14,
    color: 'var(--text-secondary)',
  },
  error: {
    padding: '12px 16px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--danger-transparent)',
    color: 'var(--danger)',
    fontSize: 14,
    marginBottom: 16,
  },
  actionBar: {
    display: 'flex',
    gap: 12,
    marginBottom: 20,
    flexWrap: 'wrap' as const,
  },
  actionBtn: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    cursor: 'pointer',
  },
  deleteBtn: {
    background: 'var(--accent)',
  },
  deleteAllBtn: {
    background: '#e67e22',
  },
  shutdownBtn: {
    background: '#e74c3c',
  },
  empty: {
    textAlign: 'center' as const,
    padding: 64,
    color: 'var(--text-secondary)',
    fontSize: 15,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyHint: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    marginTop: 8,
  },
  tableWrap: {
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    background: 'var(--bg-secondary)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-tertiary)',
  },
  tr: {
    borderBottom: '1px solid var(--border)',
    transition: 'background 0.15s',
  },
  td: {
    padding: '12px 16px',
    fontSize: 14,
    color: 'var(--text-primary)',
  },
  mono: {
    fontFamily: 'var(--font-mono, "SF Mono", "Cascadia Code", monospace)',
    fontSize: 13,
  },
  checkbox: {
    width: 16,
    height: 16,
    cursor: 'pointer',
    accentColor: 'var(--accent)',
  },
  badgeOn: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: '#27ae60',
    color: '#fff',
  },
  badgeOff: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: 'var(--bg-tertiary)',
    color: 'var(--text-tertiary)',
  },
};
