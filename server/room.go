package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// ============================================================
// 数据模型
// ============================================================

type BuzzerEntry struct {
	Name   string `json:"name"`
	Time   int64  `json:"time"`
	UserID string `json:"userId"`
}

type PlayerInfo struct {
	Name   string `json:"name"`
	UserID string `json:"userId"`
	JoinAt int64  `json:"joinAt"`
}

type Room struct {
	ID              string            `json:"id"`
	Secret          string            `json:"secret"`
	CreatedAt       int64             `json:"createdAt"`
	Buzzers         []BuzzerEntry     `json:"buzzers"`
	CountdownActive bool              `json:"countdownActive"`
	Players         []PlayerInfo      `json:"players"`
	Strokes         []json.RawMessage `json:"-"`
	mu              sync.RWMutex
	adminClients    map[*websocket.Conn]bool
	playerClients   map[*websocket.Conn]bool
	drawerClients   map[*websocket.Conn]bool
	playerInfo      map[*websocket.Conn]*PlayerInfo
}

type RoomStore struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

var (
	store    = &RoomStore{rooms: make(map[string]*Room)}
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

// ============================================================
// 工具函数
// ============================================================

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rng.Intn(len(letters))]
	}
	return string(b)
}

func adminAuth(r *http.Request) bool {
	key := r.Header.Get("X-Admin-Key")
	return key != "" && key == adminKey
}

func joinPath(dir, name string) string {
	return dir + "/" + name
}

// ============================================================
// HTTP 处理器
// ============================================================

func createRoom(w http.ResponseWriter, r *http.Request) {
	if !adminAuth(r) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	roomID := uuid.New().String()[:8]

	// 尝试从磁盘恢复笔画
	strokes := make([]json.RawMessage, 0, 2000)
	if diskStrokes := loadStrokesFromDisk(roomID); diskStrokes != nil {
		strokes = diskStrokes
		log.Printf("从磁盘恢复 %d 笔画 → 房间 %s", len(strokes), roomID)
	}

	room := &Room{
		ID:            roomID,
		Secret:        randomString(12),
		CreatedAt:     time.Now().UnixMilli(),
		Buzzers:       make([]BuzzerEntry, 0),
		Players:       make([]PlayerInfo, 0),
		Strokes:       strokes,
		adminClients:  make(map[*websocket.Conn]bool),
		playerClients: make(map[*websocket.Conn]bool),
		drawerClients: make(map[*websocket.Conn]bool),
		playerInfo:    make(map[*websocket.Conn]*PlayerInfo),
	}

	store.mu.Lock()
	store.rooms[room.ID] = room
	store.mu.Unlock()

	log.Printf("房间创建: %s (secret=%s)", room.ID, room.Secret)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"roomId": room.ID,
		"secret": room.Secret,
	})
}

func getRoom(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("roomId")
	secret := r.URL.Query().Get("secret")

	if roomID == "" || secret == "" {
		http.Error(w, `{"error":"missing roomId or secret"}`, http.StatusBadRequest)
		return
	}

	store.mu.RLock()
	room, ok := store.rooms[roomID]
	store.mu.RUnlock()

	if !ok || room.Secret != secret {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}

	room.mu.RLock()
	defer room.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"roomId":    room.ID,
		"createdAt": room.CreatedAt,
		"buzzers":   room.Buzzers,
	})
}

func clearBuzzers(w http.ResponseWriter, r *http.Request) {
	if !adminAuth(r) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	roomID := r.URL.Query().Get("roomId")
	if roomID == "" {
		http.Error(w, `{"error":"missing roomId"}`, http.StatusBadRequest)
		return
	}

	store.mu.RLock()
	room, ok := store.rooms[roomID]
	store.mu.RUnlock()

	if !ok {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}

	room.mu.Lock()
	room.Buzzers = make([]BuzzerEntry, 0)
	room.mu.Unlock()

	broadcastToAdmin(room)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func verifyRoom(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("roomId")
	secret := r.URL.Query().Get("secret")

	if roomID == "" || secret == "" {
		http.Error(w, `{"error":"missing roomId or secret"}`, http.StatusBadRequest)
		return
	}

	store.mu.RLock()
	room, ok := store.rooms[roomID]
	store.mu.RUnlock()

	if !ok || room.Secret != secret {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
