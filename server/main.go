package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
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

	// 管理员管理 API
	mux.HandleFunc("/api/admin/rooms", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			listAdminRooms(w, r)
		case http.MethodDelete:
			deleteAdminRooms(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/admin/shutdown", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			shutdownServer(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})

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

	srv = &http.Server{
		Addr:    ":" + port,
		Handler: handler,
	}

	// 监听系统信号，实现优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("收到系统信号，正在优雅关闭...")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("服务器关闭错误: %v", err)
		}
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("服务器启动失败: %v", err)
	}

	log.Println("服务器已关闭")
}
