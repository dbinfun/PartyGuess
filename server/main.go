package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/rs/cors"
)

// ============================================================
// 全局配置
// ============================================================

var (
	adminKey   string
	strokesDir string // 笔画持久化目录
)

// ============================================================
// 主入口
// ============================================================

func main() {
	adminKey = os.Getenv("ADMIN_KEY")
	if adminKey == "" {
		adminKey = "admin123"
	}

	strokesDir = os.Getenv("STROKES_DIR")
	if strokesDir == "" {
		strokesDir = "./strokes"
	}

	log.Printf("Admin Key: %s", adminKey)
	log.Printf("笔画存储目录: %s", strokesDir)

	// 房间过期清理
	startRoomCleaner(5*time.Minute, 1*time.Hour)

	mux := http.NewServeMux()

	// API
	mux.HandleFunc("/api/rooms", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			createRoom(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	mux.HandleFunc("/api/rooms/info", getRoom)
	mux.HandleFunc("/api/rooms/buzzers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			clearBuzzers(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	mux.HandleFunc("/api/rooms/verify", verifyRoom)

	// WebSocket
	mux.HandleFunc("/ws/room", wsHandler)

	// 静态文件 + SPA
	staticDir := findStaticDir()
	if staticDir != "" {
		mux.Handle("/", &spaFileServer{
			fs:        http.FileServer(http.Dir(staticDir)),
			indexPath: joinPath(staticDir, "index.html"),
		})
	} else {
		log.Println("⚠ 未找到前端静态文件，仅提供 API 服务")
		mux.HandleFunc("/", fallbackHandler)
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
