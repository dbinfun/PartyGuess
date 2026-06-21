const BASE = '';

export interface BuzzerEntry {
  name: string;
  time: number;
  userId: string;
}

// ============================================================
// HTTP API
// ============================================================

export async function createRoom(adminKey: string): Promise<{ roomId: string; secret: string }> {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getRoomInfo(roomId: string, secret: string) {
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
// Admin WebSocket
// ============================================================

export interface AdminWSCallbacks {
  onUpdate: (buzzers: BuzzerEntry[]) => void;
  onState: (buzzers: BuzzerEntry[], countdownActive: boolean) => void;
}

export function connectAdmin(
  roomId: string,
  secret: string,
  cbs: AdminWSCallbacks,
): { sendCountdown: (active: boolean) => void; close: () => void } {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/room?roomId=${roomId}&role=admin&secret=${secret}`);

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'update') cbs.onUpdate(data.buzzers || []);
      if (data.type === 'state') cbs.onState(data.buzzers || [], !!data.countdownActive);
    } catch { /* ignore */ }
  };

  ws.onclose = () => setTimeout(() => connectAdmin(roomId, secret, cbs), 3000);

  return {
    sendCountdown: (active: boolean) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'countdown', active }));
      }
    },
    close: () => ws.close(),
  };
}

// ============================================================
// Player WebSocket
// ============================================================

export interface PlayerWSCallbacks {
  onJoined: (userId: string) => void;
  onBuzzAck: (success: boolean, error?: string) => void;
  onCountdown: (active: boolean) => void;
}

export function connectPlayer(
  roomId: string,
  name: string,
  cbs: PlayerWSCallbacks,
): { sendBuzz: () => void; close: () => void } {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/room?roomId=${roomId}&role=player`);

  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', name }));

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      switch (data.type) {
        case 'joined':
          cbs.onJoined(data.userId);
          if (data.countdownActive !== undefined) cbs.onCountdown(!!data.countdownActive);
          break;
        case 'buzzAck':
          cbs.onBuzzAck(!!data.success, data.error);
          break;
        case 'countdown':
          cbs.onCountdown(!!data.countdownActive);
          break;
      }
    } catch { /* ignore */ }
  };

  return {
    sendBuzz: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'buzz' }));
      }
    },
    close: () => ws.close(),
  };
}
