#!/bin/bash

echo "=========================================="
echo "🔄 重启服务 - $(date)"
echo "=========================================="

echo "📥 拉取最新代码..."
git stash
git pull
git stash pop 2>/dev/null || true

echo "📦 安装依赖..."
npm install

echo "🛑 停止旧服务..."
pkill -f "node app.js" 2>/dev/null || true
fuser -k 8080/tcp 2>/dev/null || true
sleep 1

echo "🚀 启动服务..."
nohup npm start > app.log 2>&1 &

echo "=========================================="
echo "✅ 重启完成 - $(date)"
echo "=========================================="
echo "📋 查看日志: tail -f app.log"