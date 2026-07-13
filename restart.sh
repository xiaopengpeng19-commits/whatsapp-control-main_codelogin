#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "🔄 重启服务 - $(date)"
echo "=========================================="

echo "📥 拉取最新代码..."
git pull origin master

echo "📦 安装依赖..."
npm install

echo "🛑 停止旧服务..."
pm2 stop app 2>/dev/null || true
pm2 delete app 2>/dev/null || true

# ========== 强制清理端口 ==========
echo "🧹 清理端口 8080..."
fuser -k 8080/tcp 2>/dev/null || true
sleep 1

echo "🚀 启动服务..."
pm2 start app.js --name app
pm2 save

echo "=========================================="
echo "✅ 重启完成 - $(date)"
echo "=========================================="

pm2 logs app --lines 10