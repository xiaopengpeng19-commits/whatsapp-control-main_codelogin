// src/config/heartbeat.js
const natsConfig = require("./nats");
const { getModule } = require("../utils/logger");
const logger = getModule("heartbeat");

let timer = null;

function startHeartbeat(intervalMs = 10000) {
  if (timer) return;

  const startTime = Date.now();

  timer = setInterval(async () => {
    try {
      const mu = process.memoryUsage();
      const mb = (n) => Math.round(n / 1024 / 1024);
      
      const payload = {
        event: "heartbeat",
        status: "online",
        pid: process.pid,
        uptime: Math.floor((Date.now() - startTime) / 1000), // 运行秒数
        timestamp: new Date().toISOString(),
        memory: {
          rss: mb(mu.rss),
          heapUsed: mb(mu.heapUsed),
          heapTotal: mb(mu.heapTotal)
        }
      };

      // 发布心跳
      await natsConfig.publishMessage("system.heartbeat", payload);
    } catch (err) {
      // 心跳失败不抛出，静默等下一轮（如果连 NATS 都没了，等重连）
      logger.error("发送心跳失败:", err);
    }
  }, intervalMs);

  logger.info(`❤️ 心跳广播已启动，间隔 ${intervalMs / 1000} 秒`);
}

function stopHeartbeat() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("心跳广播已停止");
  }
}

module.exports = { startHeartbeat, stopHeartbeat };