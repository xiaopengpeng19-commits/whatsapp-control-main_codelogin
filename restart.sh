#!/bin/bash

echo "=========================================="
echo "🔄 重启服务 - $(date)"
echo "=========================================="

# 1. 拉取最新代码
echo "📥 拉取最新代码..."
git stash
git pull
git stash pop 2>/dev/null || true

# 2. 安装依赖
echo "📦 安装依赖..."
npm install

# 3. 杀掉旧进程
echo "🛑 停止旧服务..."
pkill -f "node app.js" 2>/dev/null || true
fuser -k 8080/tcp 2>/dev/null || true
sleep 1

# 4. 启动服务
echo "🚀 启动服务..."
npm start

echo "=========================================="
echo "✅ 重启完成 - $(date)"
echo "=========================================="