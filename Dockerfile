# ============================================================
# 阶段 1: 构建前端
# ============================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ============================================================
# 阶段 2: 构建后端
# ============================================================
FROM golang:1.21-alpine AS backend-builder
WORKDIR /app/server
COPY server/go.mod server/go.sum* ./
RUN go mod download
COPY server/ ./
# 将前端产物嵌入到 server 目录中
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux go build -o buzzer-server .

# ============================================================
# 阶段 3: 运行镜像
# ============================================================
FROM alpine:3.20
RUN apk --no-cache add ca-certificates tzdata
ENV TZ=Asia/Shanghai
WORKDIR /app

COPY --from=backend-builder /app/server/buzzer-server .
COPY --from=backend-builder /app/server/frontend/dist ./frontend/dist

EXPOSE 8080

ENV ADMIN_KEY=admin123
ENV PORT=8080

ENTRYPOINT ["./buzzer-server"]
