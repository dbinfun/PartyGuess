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

type PlayerInfo struct {
	Name   string `json:"name"`
	UserID string `json:"userId"`
	JoinAt int64  `json:"joinAt"`
}

type Room struct {
	ID              string        `json:"id"`
	Secret          string        `json:"secret"` // 随机字符串，用于 URL 安全
	CreatedAt       int64         `json:"createdAt"`
	Buzzers         []BuzzerEntry `json:"buzzers"`
	CountdownActive bool          `json:"countdownActive"`
	Players         []PlayerInfo  `json:"players"`
	mu              sync.RWMutex
	adminClients    map[*websocket.Conn]bool          // 管理端 WebSocket 连接
	playerClients   map[*websocket.Conn]bool          // 玩家 WebSocket 连接
	drawerClients   map[*websocket.Conn]bool          // 画手 WebSocket 连接
	playerInfo      map[*websocket.Conn]*PlayerInfo   // 玩家连接 → 信息
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
		ID:            uuid.New().String()[:8],
		Secret:        randomString(12),
		CreatedAt:     time.Now().UnixMilli(),
		Buzzers:       make([]BuzzerEntry, 0),
		Players:       make([]PlayerInfo, 0),
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

	if (role == "admin" || role == "drawer") && secret != room.Secret {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("ws upgrade:", err)
		return
	}
	defer conn.Close()

	switch role {
	case "admin":
		room.mu.Lock()
		room.adminClients[conn] = true
		room.mu.Unlock()

		// 发送当前状态
		room.mu.RLock()
		sendJSON(conn, map[string]interface{}{
			"type":             "state",
			"buzzers":          room.Buzzers,
			"players":          room.Players,
			"countdownActive":  room.CountdownActive,
		})
		room.mu.RUnlock()

		// 读取管理员消息（倒计时控制等）
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
			case "countdown":
				active, _ := data["active"].(bool)
				room.mu.Lock()
				room.CountdownActive = active
				// 清空上一轮抢答
				if active {
					room.Buzzers = make([]BuzzerEntry, 0)
				}
				room.mu.Unlock()

				log.Printf("房间 %s 倒计时: %v", roomID, active)

				// 广播给所有玩家
				broadcastToPlayers(room, map[string]interface{}{
					"type":             "countdown",
					"countdownActive":  active,
				})

				// 同步给管理员
				room.mu.RLock()
				sendJSON(conn, map[string]interface{}{
					"type":             "state",
					"buzzers":          room.Buzzers,
					"players":          room.Players,
					"countdownActive":  room.CountdownActive,
				})
				room.mu.RUnlock()
			}
		}

		room.mu.Lock()
		delete(room.adminClients, conn)
		room.mu.Unlock()

	case "drawer":
		// 画手连接：注册并中继笔画到管理员
		room.mu.Lock()
		room.drawerClients[conn] = true
		room.mu.Unlock()

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			// 直接中继消息给所有管理客户端
			room.mu.RLock()
			for c := range room.adminClients {
				c.WriteMessage(websocket.TextMessage, msg)
			}
			room.mu.RUnlock()
		}

		room.mu.Lock()
		delete(room.drawerClients, conn)
		room.mu.Unlock()

	default:
		// 玩家连接
		var playerName string
		var playerID string

		room.mu.Lock()
		room.playerClients[conn] = true
		// 发送当前倒计时状态
		cdActive := room.CountdownActive
		room.mu.Unlock()

		if cdActive {
			sendJSON(conn, map[string]interface{}{
				"type":            "countdown",
				"countdownActive": true,
			})
		}

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

				// 记录玩家信息
				pi := &PlayerInfo{Name: playerName, UserID: playerID, JoinAt: time.Now().UnixMilli()}
				room.mu.Lock()
				room.Players = append(room.Players, *pi)
				room.playerInfo[conn] = pi
				cdActive := room.CountdownActive
				room.mu.Unlock()

				sendJSON(conn, map[string]interface{}{
					"type":            "joined",
					"userId":          playerID,
					"countdownActive": cdActive,
				})
				log.Printf("玩家 %s 加入房间 %s", playerName, roomID)

				// 广播玩家列表给管理员
				broadcastToAdmin(room)

			case "buzz":
				room.mu.Lock()
				if !room.CountdownActive {
					room.mu.Unlock()
					sendJSON(conn, map[string]interface{}{
						"type":    "buzzAck",
						"success": false,
						"error":   "当前不在抢答时间",
					})
					continue
				}
				if len(room.Buzzers) >= 10 {
					room.Buzzers = room.Buzzers[1:]
				}
				room.Buzzers = append(room.Buzzers, BuzzerEntry{
					Name:   playerName,
					Time:   time.Now().UnixMilli(),
					UserID: playerID,
				})
				buzzers := room.Buzzers
				room.mu.Unlock()

				sendJSON(conn, map[string]interface{}{
					"type":    "buzzAck",
					"success": true,
				})

				broadcastToAdmin(room)
				_ = buzzers
			}
		}

		// 玩家断开：清理 + 广播
		room.mu.Lock()
		if pi, ok := room.playerInfo[conn]; ok {
			for i, p := range room.Players {
				if p.UserID == pi.UserID {
					room.Players = append(room.Players[:i], room.Players[i+1:]...)
					break
				}
			}
			delete(room.playerInfo, conn)
		}
		delete(room.playerClients, conn)
		room.mu.Unlock()

		log.Printf("玩家 %s 离开房间 %s", playerName, roomID)
		broadcastToAdmin(room)
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
	players := room.Players
	clients := make([]*websocket.Conn, 0, len(room.adminClients))
	for c := range room.adminClients {
		clients = append(clients, c)
	}
	room.mu.RUnlock()

	update := map[string]interface{}{
		"type":    "update",
		"buzzers": buzzers,
		"players": players,
	}
	data, _ := json.Marshal(update)

	for _, c := range clients {
		c.WriteMessage(websocket.TextMessage, data)
	}
}

func broadcastToPlayers(room *Room, msg map[string]interface{}) {
	room.mu.RLock()
	clients := make([]*websocket.Conn, 0, len(room.playerClients))
	for c := range room.playerClients {
		clients = append(clients, c)
	}
	room.mu.RUnlock()

	data, _ := json.Marshal(msg)
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
