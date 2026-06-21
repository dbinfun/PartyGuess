const BASE = '';

export interface BuzzerEntry {
  name: string;
  time: number;
  userId: string;
}

export interface RoomInfo {
  roomId: string;
  createdAt: number;
  buzzers: BuzzerEntry[];
}

// ============================================================
// HTTP API
// ============================================================

export async function createRoom(adminKey: string): Promise<{ roomId: string; secret: string }> {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  return res.json();
}

export async function getRoomInfo(roomId: string, secret: string): Promise<RoomInfo> {
  const res = await fetch(`${BASE}/api/rooms/info?roomId=${roomId}&secret=${secret}`);
  if (!res.ok) throw new Error('room not found');
  return res.json();
}

export async function clearBuzzers(roomId: string, adminKey: string): Promise<void> {
  const res = await fetch(`${BASE}/api/rooms/buzzers?roomId=${roomId}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': adminKey },
  });
  if (!res.ok) throw new Error('clear failed');
}

export async function verifyRoom(roomId: string, secret: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/rooms/verify?roomId=${roomId}&secret=${secret}`);
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================
// WebSocket
// ============================================================

export function connectAdmin(
  roomId: string,
  secret: string,
  onUpdate: (buzzers: BuzzerEntry[]) => void,
): () => void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host;
  const ws = new WebSocket(`${protocol}//${host}/ws/room?roomId=${roomId}&role=admin&secret=${secret}`);

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'state' || data.type === 'update') {
        onUpdate(data.buzzers || []);
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    // 断线 3 秒后重连
    setTimeout(() => connectAdmin(roomId, secret, onUpdate), 3000);
  };

  return () => ws.close();
}

export function connectPlayer(
  roomId: string,
  name: string,
  onOpen: (userId: string) => void,
  onBuzzAck: () => void,
): { sendBuzz: () => void; close: () => void } {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host;
  const ws = new WebSocket(`${protocol}//${host}/ws/room?roomId=${roomId}&role=player`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', name }));
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'joined') {
        onOpen(data.userId);
      } else if (data.type === 'buzzAck') {
        onBuzzAck();
      }
    } catch { /* ignore */ }
  };

  return {
    sendBuzz: () => ws.send(JSON.stringify({ type: 'buzz' })),
    close: () => ws.close(),
  };
}
