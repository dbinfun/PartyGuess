package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
)

// ============================================================
// SPA 静态文件服务
// ============================================================

type spaFileServer struct {
	fs        http.Handler
	indexPath string
}

func (s *spaFileServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if len(r.URL.Path) >= 4 && r.URL.Path[:4] == "/api" {
		http.NotFound(w, r)
		return
	}
	if len(r.URL.Path) >= 3 && r.URL.Path[:3] == "/ws" {
		http.NotFound(w, r)
		return
	}

	rec := &spaResponseWriter{ResponseWriter: w, status: 200}
	s.fs.ServeHTTP(rec, r)
	if rec.status == 404 {
		content, err := os.ReadFile(s.indexPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write(content)
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
		return len(b), nil
	}
	return w.ResponseWriter.Write(b)
}

func findStaticDir() string {
	candidates := []string{}
	if d := os.Getenv("STATIC_DIR"); d != "" {
		candidates = append(candidates, d)
	}
	candidates = append(candidates,
		"./frontend/dist",
		"../frontend/dist",
	)

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

func fallbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(`<html><body style="font-family:sans-serif;text-align:center;margin-top:80px">
<h2>抢答服务器已启动</h2><p>前端静态文件未找到。请构建前端再启动。</p>
<p><code>cd frontend && npm run build</code></p></body></html>`))
		return
	}
	http.NotFound(w, r)
}
