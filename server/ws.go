package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// ============================================================
// WebSocket 处理器
// ============================================================

func wsHandler(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("roomId")
	role := r.URL.Query().Get("role")
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
		handleAdmin(conn, room, roomID)
	case "drawer":
		handleDrawer(conn, room)
	default:
		handlePlayer(conn, room, roomID)
	}
}

// ---- admin ----

func handleAdmin(conn *websocket.Conn, room *Room, roomID string) {
	room.mu.Lock()
	room.adminClients[conn] = true
	room.mu.Unlock()

	room.mu.RLock()
	sendJSON(conn, map[string]interface{}{
		"type":            "state",
		"buzzers":         room.Buzzers,
		"players":         room.Players,
		"countdownActive": room.CountdownActive,
	})

	// 回放历史笔画：优先内存，内存为空则从磁盘加载
	replayStrokes := room.Strokes
	if len(replayStrokes) == 0 {
		if diskStrokes := loadStrokesFromDisk(room.ID); diskStrokes != nil {
			replayStrokes = diskStrokes
			room.Strokes = diskStrokes
			log.Printf("从磁盘回放 %d 笔画 → 房间 %s", len(replayStrokes), room.ID)
		}
	}
	sendJSON(conn, map[string]interface{}{
		"type":    "replay",
		"strokes": replayStrokes,
	})
	room.mu.RUnlock()

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
			if active {
				room.Buzzers = make([]BuzzerEntry, 0)
			}
			room.mu.Unlock()

			log.Printf("房间 %s 倒计时: %v", roomID, active)

			broadcastToPlayers(room, map[string]interface{}{
				"type":            "countdown",
				"countdownActive": active,
			})

			room.mu.RLock()
			sendJSON(conn, map[string]interface{}{
				"type":            "state",
				"buzzers":         room.Buzzers,
				"players":         room.Players,
				"countdownActive": room.CountdownActive,
			})
			room.mu.RUnlock()
		}
	}

	room.mu.Lock()
	delete(room.adminClients, conn)
	room.mu.Unlock()
}

// ---- drawer ----

func handleDrawer(conn *websocket.Conn, room *Room) {
	room.mu.Lock()
	room.drawerClients[conn] = true
	room.mu.Unlock()

	// 发送历史回放（同 admin），让画手刷新后也能看到之前的内容
	room.mu.RLock()
	replayStrokes := room.Strokes
	if len(replayStrokes) == 0 {
		if diskStrokes := loadStrokesFromDisk(room.ID); diskStrokes != nil {
			replayStrokes = diskStrokes
			room.Strokes = diskStrokes
		}
	}
	sendJSON(conn, map[string]interface{}{
		"type":    "replay",
		"strokes": replayStrokes,
	})
	room.mu.RUnlock()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var meta struct {
			Type string `json:"type"`
		}
		json.Unmarshal(msg, &meta)

		room.mu.Lock()
		switch meta.Type {
		case "stroke":
			if len(room.Strokes) >= 2000 {
				room.Strokes = room.Strokes[1:]
			}
			room.Strokes = append(room.Strokes, msg)
			saveStrokesToDisk(room.ID, room.Strokes)
		case "clearCanvas":
			room.Strokes = room.Strokes[:0]
			saveStrokesToDisk(room.ID, nil)
		}
		room.mu.Unlock()

		room.mu.RLock()
		for c := range room.adminClients {
			c.WriteMessage(websocket.TextMessage, msg)
		}
		room.mu.RUnlock()
	}

	room.mu.Lock()
	delete(room.drawerClients, conn)
	room.mu.Unlock()
}

// ---- player ----

func handlePlayer(conn *websocket.Conn, room *Room, roomID string) {
	var playerName string
	var playerID string

	room.mu.Lock()
	room.playerClients[conn] = true
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

	// 清理
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

// ============================================================
// 广播助手
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
