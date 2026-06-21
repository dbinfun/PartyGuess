package main

import (
	"encoding/json"
	"log"
	"os"
	"time"
)

// ============================================================
// 磁盘持久化（笔画）
// ============================================================

func strokesFilePath(roomID string) string {
	return strokesDir + "/" + roomID + ".json"
}

func saveStrokesToDisk(roomID string, strokes []json.RawMessage) {
	if strokesDir == "" {
		return
	}
	os.MkdirAll(strokesDir, 0755)
	path := strokesFilePath(roomID)
	data, err := json.Marshal(strokes)
	if err != nil {
		log.Printf("序列化笔画失败: %v", err)
		return
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		log.Printf("写入笔画文件失败 %s: %v", path, err)
	}
}

func loadStrokesFromDisk(roomID string) []json.RawMessage {
	if strokesDir == "" {
		return nil
	}
	path := strokesFilePath(roomID)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var strokes []json.RawMessage
	if err := json.Unmarshal(data, &strokes); err != nil {
		log.Printf("解析笔画文件失败 %s: %v", path, err)
		return nil
	}
	return strokes
}

func deleteStrokesFile(roomID string) {
	if strokesDir == "" {
		return
	}
	os.Remove(strokesFilePath(roomID))
}

// ============================================================
// 房间过期清理
// ============================================================

func startRoomCleaner(interval time.Duration, maxAge time.Duration) {
	go func() {
		for {
			time.Sleep(interval)
			now := time.Now().UnixMilli()
			store.mu.Lock()
			for id, room := range store.rooms {
				room.mu.RLock()
				hasActivity := len(room.adminClients) > 0 ||
					len(room.playerClients) > 0 ||
					len(room.drawerClients) > 0
				age := now - room.CreatedAt
				room.mu.RUnlock()

				if !hasActivity && age > maxAge.Milliseconds() {
					log.Printf("清理过期房间: %s (age=%v)", id, time.Duration(age)*time.Millisecond)
					delete(store.rooms, id)
					deleteStrokesFile(id)
				}
			}
			store.mu.Unlock()
		}
	}()
}
