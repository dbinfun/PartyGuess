package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

// ============================================================
// 数据模型
// ============================================================

type BuzzerEntry struct {
	Name   string `json:"name"`
	Time   int64  `json:"time"` // unix millis
	UserID string `json:"userId"`
}

type Room struct {
	ID        string        `json:"id"`
	Secret    string        `json:"secret"` // 随机字符串，用于 URL 安全
	CreatedAt int64         `json:"createdAt"`
	Buzzers   []BuzzerEntry `json:"buzzers"`
	mu        sync.RWMutex
	clients   map[*websocket.Conn]bool // 管理端 WebSocket 连接
}

type RoomStore struct {
	mu    sync.RWMutex
	rooms map[string]*Room // key = roomId
}

var (
	store    = &RoomStore{rooms: make(map[string]*Room)}
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	adminKey string
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

// ============================================================
// HTTP 处理器
// ============================================================

// POST /api/rooms — 创建房间
func createRoom(w http.ResponseWriter, r *http.Request) {
	if !adminAuth(r) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	room := &Room{
		ID:        uuid.New().String()[:8],
		Secret:    randomString(12),
		CreatedAt: time.Now().UnixMilli(),
		Buzzers:   make([]BuzzerEntry, 0),
		clients:   make(map[*websocket.Conn]bool),
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

// GET /api/rooms/:id — 获取房间信息（需 secret）
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

// DELETE /api/rooms/:id/buzzers — 清空抢答列表（需 admin-key）
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

	// 广播更新给管理端
	broadcastToAdmin(room)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// GET /api/rooms/:id/verify — 验证房间存在且 secret 正确
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

// ============================================================
// WebSocket
// ============================================================

func wsHandler(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("roomId")
	role := r.URL.Query().Get("role") // "admin" 或 "player"
	secret := r.URL.Query().Get("secret")

	if roomID == "" || role == "" {
		http.Error(w, "missing params", http.StatusBadRequest)
		return
	}

	store.mu.RLock()
	room, ok := store.rooms[roomID]
	store.mu.RUnlock()

	if !ok {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}

	if role == "admin" {
		// 管理员需要 secret
		if secret != room.Secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	} else {
		// 玩家只需要房间存在（进一步校验可行）
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("ws upgrade:", err)
		return
	}
	defer conn.Close()

	if role == "admin" {
		room.mu.Lock()
		room.clients[conn] = true
		room.mu.Unlock()

		// 发送当前状态
		room.mu.RLock()
		sendJSON(conn, map[string]interface{}{
			"type":    "state",
			"buzzers": room.Buzzers,
		})
		room.mu.RUnlock()

		// 保持连接，直到断开
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}

		room.mu.Lock()
		delete(room.clients, conn)
		room.mu.Unlock()
	} else {
		// 玩家连接
		var playerName string
		var playerID string

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}

			var data map[string]interface{}
			if err := json.Unmarshal(msg, &data); err != nil {
				continue
			}

			switch data["type"] {
			case "join":
				playerName, _ = data["name"].(string)
				playerID = uuid.New().String()
				sendJSON(conn, map[string]interface{}{
					"type":   "joined",
					"userId": playerID,
				})
				log.Printf("玩家 %s 加入房间 %s", playerName, roomID)

			case "buzz":
				// 处理抢答
				room.mu.Lock()
				if len(room.Buzzers) >= 10 {
					// 移除最早的一个
					room.Buzzers = room.Buzzers[1:]
				}
				room.Buzzers = append(room.Buzzers, BuzzerEntry{
					Name:   playerName,
					Time:   time.Now().UnixMilli(),
					UserID: playerID,
				})
				buzzers := room.Buzzers
				room.mu.Unlock()

				// 通知当前玩家
				sendJSON(conn, map[string]interface{}{
					"type":    "buzzAck",
					"success": true,
				})

				// 广播给管理员
				broadcastToAdmin(room)
				_ = buzzers
			}
		}
	}
}

// ============================================================
// 助手
// ============================================================

func sendJSON(conn *websocket.Conn, v interface{}) {
	data, _ := json.Marshal(v)
	conn.WriteMessage(websocket.TextMessage, data)
}

func broadcastToAdmin(room *Room) {
	room.mu.RLock()
	buzzers := room.Buzzers
	clients := make([]*websocket.Conn, 0, len(room.clients))
	for c := range room.clients {
		clients = append(clients, c)
	}
	room.mu.RUnlock()

	update := map[string]interface{}{
		"type":    "update",
		"buzzers": buzzers,
	}
	data, _ := json.Marshal(update)

	for _, c := range clients {
		c.WriteMessage(websocket.TextMessage, data)
	}
}

// ============================================================
// 静态文件服务（SPA fallback）
// ============================================================

// spaFileServer 包装 http.FileServer，对不存在的路径返回 index.html（SPA 回退）
type spaFileServer struct {
	fs http.Handler
}

func (s *spaFileServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 如果是 API 或 WebSocket，不处理
	if len(r.URL.Path) >= 4 && r.URL.Path[:4] == "/api" {
		http.NotFound(w, r)
		return
	}
	if len(r.URL.Path) >= 3 && r.URL.Path[:3] == "/ws" {
		http.NotFound(w, r)
		return
	}

	// 尝试直接提供文件，404 则回退到 index.html
	rec := &spaResponseWriter{ResponseWriter: w, status: 200}
	s.fs.ServeHTTP(rec, r)
	if rec.status == 404 {
		// 重写路径为 /index.html
		r2 := *r
		r2.URL.Path = "/index.html"
		s.fs.ServeHTTP(w, &r2)
	}
}

type spaResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *spaResponseWriter) WriteHeader(code int) {
	w.status = code
	if code != 404 {
		w.ResponseWriter.WriteHeader(code)
	}
}

func (w *spaResponseWriter) Write(b []byte) (int, error) {
	if w.status == 404 {
		return len(b), nil // 吞掉 404 的 body
	}
	return w.ResponseWriter.Write(b)
}

func findStaticDir() string {
	// 按优先级查找静态文件目录
	candidates := []string{}
	if d := os.Getenv("STATIC_DIR"); d != "" {
		candidates = append(candidates, d)
	}
	candidates = append(candidates,
		"./frontend/dist",    // 从项目根运行（开发 + CI 产物）
		"../frontend/dist",   // 从 server/ 运行（开发）
	)

	// 也查找二进制同目录下的 dist（CI 发布包结构）
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "frontend", "dist"),
			filepath.Join(exeDir, "dist"),
		)
	}

	for _, d := range candidates {
		abs, _ := filepath.Abs(d)
		idx := filepath.Join(d, "index.html")
		if _, err := os.Stat(idx); err == nil {
			log.Printf("静态文件目录: %s", abs)
			return d
		}
	}
	return ""
}

// ============================================================
// 主入口
// ============================================================

func main() {
	adminKey = os.Getenv("ADMIN_KEY")
	if adminKey == "" {
		adminKey = "admin123" // 默认 key
	}

	log.Printf("Admin Key: %s", adminKey)

	mux := http.NewServeMux()

	// API 路由
	mux.HandleFunc("/api/rooms", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			createRoom(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/rooms/info", func(w http.ResponseWriter, r *http.Request) {
		getRoom(w, r)
	})

	mux.HandleFunc("/api/rooms/buzzers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			clearBuzzers(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/rooms/verify", func(w http.ResponseWriter, r *http.Request) {
		verifyRoom(w, r)
	})

	// WebSocket
	mux.HandleFunc("/ws/room", wsHandler)

	// 静态文件 + SPA 回退
	staticDir := findStaticDir()
	if staticDir != "" {
		mux.Handle("/", &spaFileServer{fs: http.FileServer(http.Dir(staticDir))})
	} else {
		log.Println("⚠ 未找到前端静态文件，仅提供 API 服务")
		log.Println("  请先构建前端: cd frontend && npm run build")
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Write([]byte(`<html><body style="font-family:sans-serif;text-align:center;margin-top:80px">
<h2>抢答服务器已启动</h2><p>前端静态文件未找到。请构建前端再启动。</p>
<p><code>cd frontend && npm run build</code></p></body></html>`))
				return
			}
			http.NotFound(w, r)
		})
	}

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 服务器启动在 http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
