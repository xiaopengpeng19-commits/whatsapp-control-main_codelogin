// src/routes/monitor.js

const Router = require('koa-router');
const { connectionPool } = require('../services/baileys/connect');

const router = new Router();

// 获取连接池状态
router.get('/pool/status', async (ctx) => {
  try {
    const connections = [];
    for (const [id, entry] of connectionPool.connections || []) {
      connections.push({
        accountId: id,
        lastUsed: entry?.lastUsed,
        createdAt: entry?.createdAt
      });
    }

    ctx.body = {
      code: 200,
      data: {
        current: connectionPool.size ? connectionPool.size() : 0,
        max: connectionPool.maxSize || 150,
        min: connectionPool.minSize || 10,
        pending: connectionPool.queueSize ? connectionPool.queueSize() : 0,
        connections: connections,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    ctx.body = {
      code: 500,
      message: error.message
    };
  }
});

// 获取连接池统计
router.get('/pool/stats', async (ctx) => {
  try {
    const connections = connectionPool.connections || new Map();
    let totalLastUsed = 0;
    let count = 0;

    for (const [id, entry] of connections) {
      if (entry?.lastUsed) {
        totalLastUsed += entry.lastUsed;
        count++;
      }
    }

    const avgLastUsed = count > 0 ? totalLastUsed / count : 0;

    ctx.body = {
      code: 200,
      data: {
        total: connections.size,
        max: connectionPool.maxSize || 150,
        min: connectionPool.minSize || 10,
        pending: connectionPool.queueSize ? connectionPool.queueSize() : 0,
        avgLastUsed: new Date(avgLastUsed).toISOString(),
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    ctx.body = {
      code: 500,
      message: error.message
    };
  }
});

// 清理空闲连接（手动触发）
router.post('/pool/evict', async (ctx) => {
  try {
    const evicted = connectionPool.evictIdle();
    ctx.body = {
      code: 200,
      data: {
        evicted: evicted,
        current: connectionPool.size()
      }
    };
  } catch (error) {
    ctx.body = {
      code: 500,
      message: error.message
    };
  }
});

module.exports = router;