# 📣 抢答系统

一个基于 **Go + React** 的实时抢答 / 协作画布系统，适用于课堂问答、活动互动、在线协作等场景。

---

## ✨ 功能

- 🔐 **管理员面板** — Admin Key 认证，创建房间
- ⏱ **倒计时器** — 15/30/45/60/90 秒，支持暂停/继续/停止
- 📷 **摄像头预览** — 纯前端，自适应 4K/2K/1080p
- 📱 **抢答系统** — 用户扫码 → 输入名字 → 点击抢答，最多 10 人上榜
- 🎨 **协作画布** — 扫码作画，笔画实时同步到管理员，超低流量消耗
- 👥 **在线列表** — 实时显示加入房间的玩家
- 🌓 **Apple 设计风格** — SF 字体、毛玻璃、白天/黑夜主题
- 📦 **单二进制部署** — Go 后端内嵌前端静态文件

---

## 🚀 快速开始

### 前置要求

- [Go](https://go.dev/) 1.21+
- [Node.js](https://nodejs.org/) 20+
- (可选) [Docker](https://www.docker.com/)

### 本地开发

```bash
# 1. 构建前端
cd frontend
npm install
npm run build

# 2. 启动后端 (静态文件自动托管)
cd ../server
ADMIN_KEY=my-secret-key go run main.go

# 浏览器打开 http://localhost:8080
```

> **方式二：前后端分离开发**
> ```bash
> # 终端 1: 后端
> cd server && go run main.go
>
> # 终端 2: 前端 (带热更新，端口 3000)
> cd frontend && npm run dev
> ```

### Docker 部署

#### 从源码构建

```bash
docker build -t buzzer-server .
docker run -d -p 8080:8080 \
  -e ADMIN_KEY=my-secret-key \
  --name buzzer \
  buzzer-server
```

#### 从 GitHub Container Registry 拉取

```bash
docker pull ghcr.io/<你的用户名>/draw:latest
docker run -d -p 8080:8080 \
  -e ADMIN_KEY=my-secret-key \
  --name buzzer \
  ghcr.io/<你的用户名>/draw:latest
```

#### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  buzzer:
    image: ghcr.io/<你的用户名>/draw:latest
    container_name: buzzer
    ports:
      - "8080:8080"
    environment:
      - ADMIN_KEY=${ADMIN_KEY:-admin123}
      - PORT=8080
    restart: unless-stopped
```

```bash
ADMIN_KEY=my-secret-key docker compose up -d
```

---

## 🔧 Nginx 反向代理

### 基础配置 (HTTP)

```nginx
server {
    listen 80;
    server_name buzzer.example.com;

    # API + WebSocket 代理
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 升级 (必需的)
    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;   # 长连接不超时
        proxy_send_timeout 86400;
    }
}
```

### HTTPS + SSL (推荐)

> 摄像头 (`getUserMedia`) 和 WebSocket 在 HTTPS 下更稳定。HTTP 下摄像头可能不可用。

```nginx
server {
    listen 443 ssl http2;
    server_name buzzer.example.com;

    ssl_certificate     /etc/ssl/certs/buzzer.crt;
    ssl_certificate_key /etc/ssl/private/buzzer.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 前端静态文件 (可选——Go 后端已自带)
    # 如果直接用 Nginx 提供静态文件可提高性能:
    # root /path/to/frontend/dist;
    # location / {
    #     try_files $uri $uri/ /index.html;
    # }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}

# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name buzzer.example.com;
    return 301 https://$host$request_uri;
}
```

### Nginx 静态文件直出 (高性能)

如果在外面再加一层 Nginx 直接提供静态文件（绕过后端的 Go FileServer），可以这样：

```nginx
server {
    listen 443 ssl http2;
    server_name buzzer.example.com;

    # ... SSL 配置同上 ...

    # Nginx 直接提供静态文件
    root /opt/buzzer/frontend/dist;

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Admin-Key $http_x_admin_key;
    }

    # WebSocket
    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # SPA fallback: 前端路由交给 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> 使用此配置时需将 `frontend/dist` 目录复制到 `/opt/buzzer/frontend/dist`。

---

## 🔒 安全说明

| 机制 | 说明 |
|------|------|
| **Admin Key** | 环境变量 `ADMIN_KEY` 控制，创建房间 / 清空列表需要 |
| **房间 Secret** | 每个房间 12 位随机字符串，附加在 URL 中，不可猜测 |
| **画手认证** | 作画需要房间 secret，和抢答用户区分权限 |
| **HTTPS** | 强烈建议生产环境启用，否则摄像头不可用 |

---

## 📁 项目结构

```
draw/
├── server/                 # Go 后端
│   ├── main.go             # 单文件：HTTP API + WebSocket + 静态文件
│   ├── go.mod
│   └── go.sum
├── frontend/               # React 前端
│   ├── src/
│   │   ├── AdminPage.tsx   # 管理员登录
│   │   ├── RoomPage.tsx    # 房间控制面板 (摄像头/画布/倒计时/抢答)
│   │   ├── PlayPage.tsx    # 用户抢答页
│   │   ├── DrawPage.tsx    # 画手作画页
│   │   ├── App.tsx         # 路由 + ErrorBoundary
│   │   ├── api.ts          # HTTP + WebSocket 封装
│   │   ├── theme.tsx       # 主题 context (light/dark)
│   │   └── main.tsx        # 入口
│   ├── package.json
│   └── vite.config.ts
├── .github/workflows/
│   └── build.yml           # CI/CD: 三平台编译 + Docker 推送到 GHCR
├── Dockerfile
├── docker-compose.yml      # (按需自行创建)
└── README.md
```

---

## 🔌 WebSocket 协议

### 管理端连接
```
ws://host/ws/room?roomId=xxx&role=admin&secret=xxx
```

| 方向 | Type | 说明 |
|------|------|------|
| ← 接收 | `state` | 当前状态 (buzzers, players, countdownActive) |
| ← 接收 | `update` | 抢答列表/玩家列表变化 |
| ← 接收 | `stroke` | 画手笔画数据 |
| ← 接收 | `clearCanvas` | 画布清空 |
| → 发送 | `countdown` | 倒计时开关 `{active: bool}` |

### 玩家连接 (抢答)
```
ws://host/ws/room?roomId=xxx&role=player
```

| 方向 | Type | 说明 |
|------|------|------|
| → 发送 | `join` | 加入 `{name: "..."}` |
| → 发送 | `buzz` | 抢答 |
| ← 接收 | `countdown` | 倒计时状态变化 |
| ← 接收 | `buzzAck` | 抢答结果 `{success, error?}` |

### 画手连接 (作画)
```
ws://host/ws/room?roomId=xxx&role=drawer&secret=xxx
```

| 方向 | Type | 说明 |
|------|------|------|
| → 发送 | `stroke` | 笔画 `{points, color, size, tool}` |
| → 发送 | `clearCanvas` | 清空画布 |

---

## 🛠 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ADMIN_KEY` | `admin123` | 管理员密钥 |
| `PORT` | `8080` | HTTP 监听端口 |
| `STATIC_DIR` | (自动检测) | 前端静态文件目录 |

---

## 📄 License

MIT
