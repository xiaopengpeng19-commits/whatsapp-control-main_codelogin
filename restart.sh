#!/bin/bash
echo "===== 开始停止旧的 whatsapp 服务 ====="
# 杀掉运行 node app.js 的进程
pkill -f "node app.js"
sleep 1
echo "===== 旧进程已清理，重新启动服务 ====="
# 后台启动项目
nohup npm start > app.log 2>&1 &
sleep 1
echo "===== 服务启动完成，实时日志查看命令：tail -f app.log ====="
# 打印当前node进程确认
ps aux | grep node