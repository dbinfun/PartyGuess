package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
)

// ============================================================
// 管理员管理 API
// ============================================================

// srv 由 main.go 设置，用于优雅关闭
var srv *http.Server

type RoomSummary struct {
	ID              string `json:"id"`
	CreatedAt       int64  `json:"createdAt"`
	PlayerCount     int    `json:"playerCount"`
	BuzzerCount     int    `json:"buzzerCount"`
	AdminConnected  bool   `json:"adminConnected"`
	DrawerConnected bool   `json:"drawerConnected"`
}

// GET /api/admin/rooms — 列出所有房间
func listAdminRooms(w http.ResponseWriter, r *http.Request) {
	if !adminAuth(r) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	rooms := make([]RoomSummary, 0, len(store.rooms))
	for _, room := range store.rooms {
		room.mu.RLock()
		rooms = append(rooms, RoomSummary{
			ID:              room.ID,
			CreatedAt:       room.CreatedAt,
			PlayerCount:     len(room.Players),
			BuzzerCount:     len(room.Buzzers),
			AdminConnected:  len(room.adminClients) > 0,
			DrawerConnected: len(room.drawerClients) > 0,
		})
		room.mu.RUnlock()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"rooms": rooms,
		"total": len(rooms),
	})
}

// DELETE /api/admin/rooms — 批量删除房间
// 请求体: {"roomIds": ["id1","id2"]} 或 {"all": true}
func deleteAdminRooms(w http.ResponseWriter, r *http.Request) {
	if !adminAuth(r) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var req struct {
		RoomIDs []string `json:"roomIds"`
		All     bool     `json:"all"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	if !req.All && len(req.RoomIDs) == 0 {
		http.Error(w, `{"error":"must provide roomIds or all=true"}`, http.StatusBadRequest)
		return
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	var deleted int
	if req.All {
		deleted = len(store.rooms)
		for id := range store.rooms {
			deleteStrokesFile(id)
		}
		store.rooms = make(map[string]*Room)
		log.Printf("管理员清除了所有房间（共 %d 个）", deleted)
	} else {
		for _, id := range req.RoomIDs {
			if _, ok := store.rooms[id]; ok {
				delete(store.rooms, id)
				deleteStrokesFile(id)
				deleted++
			}
		}
		log.Printf("管理员删除了 %d 个房间: %v", deleted, req.RoomIDs)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"deleted": deleted,
	})
}

// POST /api/admin/shutdown — 优雅关闭服务器
func shutdownServer(w http.ResponseWriter, r *http.Request) {
	if !adminAuth(r) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "shutting down",
	})

	log.Println("收到管理员关闭指令，正在优雅关闭服务器...")

	go func() {
		if srv != nil {
			srv.Shutdown(context.Background())
		}
	}()
}
