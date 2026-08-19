// src/services/baileys/connection-pool.js

const logger = require("../../utils/logger").conn;

class ConnectionPool {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 150;
    this.minSize = options.minSize || 10;
    this.idleTimeout = options.idleTimeout || 30 * 60 * 1000;
    this.connections = new Map();
    this.pendingQueue = [];
    this.isShuttingDown = false;
  }

  async acquire(accountId, createFn) {
    // 1. 检查是否已存在连接
    if (this.connections.has(accountId)) {
      const entry = this.connections.get(accountId);
      entry.lastUsed = Date.now();
      return entry.connection;
    }

    // 2. 如果连接数已达上限，加入队列等待
    if (this.connections.size >= this.maxSize) {
      return new Promise((resolve, reject) => {
        this.pendingQueue.push({
          accountId,
          createFn,
          resolve,
          reject,
          timestamp: Date.now(),
        });
        logger.warn(`[连接池] 已达上限 ${this.maxSize}，账号 ${accountId} 等待中`);
      });
    }

    // 3. 创建新连接
    return this._createConnection(accountId, createFn);
  }

  async _createConnection(accountId, createFn) {
    try {
      const connection = await createFn();

      // ✅ 推送 NATS
      try {
        const nats = require("../../config/nats");
        let accountPhone = accountId;
        if (connection?.user?.id) {
          accountPhone = connection.user.id.split("@")[0].split(":")[0];
        } else if (connection?.auth?.creds?.me?.id) {
          accountPhone = connection.auth.creds.me.id.split("@")[0].split(":")[0];
        }

        if (accountPhone && !/^\d+$/.test(accountPhone)) {
          const match = accountPhone.match(/\d+/);
          if (match) {
            accountPhone = match[0];
          }
        }

        await nats.publishMessage("connection", {
          accountId: accountId,
          accountPhone: accountPhone,
          accountStatus: "normal",
          socketStatus: "connected",
          updatedAt: new Date().toISOString(),
        });
        logger.info(`[连接池] ✅ connection 事件已推送 (accountId: ${accountId}, phone: ${accountPhone})`);
      } catch (natsErr) {
        logger.error(`[连接池] ❌ 推送失败: ${accountId}`, natsErr);
      }

      this.connections.set(accountId, {
        connection,
        lastUsed: Date.now(),
        createdAt: Date.now(),
        accountId,
      });

      logger.info(`[连接池] 创建连接: ${accountId}，当前: ${this.connections.size}/${this.maxSize}`);
      this._processQueue();

      return connection;
    } catch (error) {
      logger.error(`[连接池] 创建连接失败: ${accountId}`, error);
      throw error;
    }
  }

  release(accountId) {
    if (this.connections.has(accountId)) {
      this.connections.delete(accountId);
      logger.info(`[连接池] 释放连接: ${accountId}，当前: ${this.connections.size}/${this.maxSize}`);
      this._processQueue();
      return true;
    }
    return false;
  }

  _processQueue() {
    if (this.pendingQueue.length === 0) return;
    if (this.connections.size >= this.maxSize) return;

    this.pendingQueue.sort((a, b) => a.timestamp - b.timestamp);

    while (this.pendingQueue.length > 0 && this.connections.size < this.maxSize) {
      const item = this.pendingQueue.shift();
      logger.info(`[连接池] 处理队列: ${item.accountId}`);
      this._createConnection(item.accountId, item.createFn)
        .then((result) => item.resolve(result))
        .catch((err) => item.reject(err));
    }
  }

  size() {
    return this.connections.size;
  }

  queueSize() {
    return this.pendingQueue.length;
  }

  has(accountId) {
    return this.connections.has(accountId);
  }

  get(accountId) {
    return this.connections.get(accountId)?.connection || null;
  }

  evictIdle() {
    const now = Date.now();
    let evicted = 0;

    for (const [accountId, entry] of this.connections) {
      if (now - entry.lastUsed > this.idleTimeout) {
        const sock = entry.connection;
        if (sock && sock.end) {
          sock.end().catch(() => {});
        }
        this.connections.delete(accountId);
        evicted++;
        logger.info(`[连接池] 清理空闲连接: ${accountId}，已闲置 ${(now - entry.lastUsed) / 60000} 分钟`);
      }
    }

    if (this.connections.size < this.minSize) {
      logger.warn(`[连接池] 连接数低于最小值 ${this.minSize}，当前: ${this.connections.size}`);
    }

    if (evicted > 0) {
      this._processQueue();
    }

    return evicted;
  }

  async clear() {
    logger.info(`[连接池] 清空所有连接...`);
    for (const [accountId, entry] of this.connections) {
      try {
        const sock = entry.connection;
        if (sock && sock.end) {
          await sock.end();
        }
      } catch (error) {
        logger.error(`[连接池] 关闭连接失败: ${accountId}`, error);
      }
    }
    this.connections.clear();
    this.pendingQueue = [];
    logger.info(`[连接池] 清空完成`);
  }
  set(accountId, sock) {
    this.connections.set(accountId, {
      connection: sock,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      accountId: accountId,
    });
    logger.info(`[连接池] 添加连接: ${accountId}，当前: ${this.connections.size}/${this.maxSize}`);
    this._processQueue();
  }
  isHealthy(accountId) {
    const entry = this.connections.get(accountId);
    if (!entry) return false;
    const sock = entry.connection;
    return sock && sock.user && sock.user.id;
  }
}

module.exports = ConnectionPool;
