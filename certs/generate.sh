#!/bin/sh
# 生成自签证书 (仅用于测试 / 局域网)
# 生产环境请替换为真实 CA 签发的证书

cd "$(dirname "$0")"

DAYS=${1:-3650}

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout buzzer.key \
  -out buzzer.crt \
  -days "$DAYS" \
  -subj "/CN=buzzer-local" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo ""
echo "✅ 证书已生成:"
echo "   certs/buzzer.crt"
echo "   certs/buzzer.key"
echo ""
echo "⚠  自签证书浏览器会报警告，局域网使用可手动信任。"
echo "   生产环境请替换为 Let's Encrypt 或其它 CA 签发的证书。"
