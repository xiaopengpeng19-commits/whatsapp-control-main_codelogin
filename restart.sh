#!/bin/bash

# 保存当前目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "🔄 重启服务 - $(date)"
echo "=========================================="

# 1. 拉取最新代码
echo "📥 拉取最新代码..."
git pull origin main || git pull origin master

# 2. 安装依赖
echo "📦 安装依赖..."
npm install

# 3. 停止旧服务
echo "🛑 停止旧服务..."
pm2 stop app 2>/dev/null || true
pm2 delete app 2>/dev/null || true

# 4. 启动服务
echo "🚀 启动服务..."
pm2 start app.js --name app

# 5. 保存 PM2 配置
pm2 save

echo "=========================================="
echo "✅ 重启完成 - $(date)"
echo "=========================================="

# 6. 查看日志
pm2 logs app --lines 10