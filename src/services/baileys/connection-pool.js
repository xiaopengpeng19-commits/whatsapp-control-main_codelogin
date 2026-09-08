// src/services/baileys/connection-pool.js

const logger = require("../../utils/logger").conn;

class ConnectionPool {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 150;
    this.minSize = options.minSize || 10;
    this.idleTimeout = options.idleTimeout || 30 * 60 * 1000;
    this.connections = new Map();
    this.isShuttingDown = false;
    // ❌ 移除 pendingQueue
  }

  // ========== 从连接中提取手机号 ==========
  _getPhoneFromConnection(connection, accountId) {
    try {
      let phone = accountId;
      if (connection?.user?.id) {
        phone = connection.user.id.split("@")[0].split(":")[0];
      } else if (connection?.auth?.creds?.me?.id) {
        phone = connection.auth.creds.me.id.split("@")[0].split(":")[0];
      }
      if (phone && !/^\d+$/.test(phone)) {
        const match = phone.match(/\d+/);
        if (match) phone = match[0];
      }
      return phone || accountId;
    } catch {
      return accountId;
    }
  }

  // ========== 获取连接 ==========
  async acquire(accountId, createFn) {
    // 1. 检查是否已存在连接
    if (this.connections.has(accountId)) {
      const entry = this.connections.get(accountId);
      entry.lastUsed = Date.now();
      return entry.connection;
    }

    // ========== 2. 连接池满 → 拒绝 ==========
    if (this.connections.size >= this.maxSize) {
      const error = new Error(`连接池已满 (${this.maxSize}/${this.maxSize})，请稍后重试`);
      error.code = "POOL_FULL";
      logger.warn(`[连接池] 拒绝连接: ${accountId}，已达上限 ${this.maxSize}`);
      throw error;
    }

    // 3. 创建新连接
    return this._createConnection(accountId, createFn);
  }

  // ========== 创建连接 ==========
  async _createConnection(accountId, createFn) {
    try {
      const connection = await createFn();
      const phone = this._getPhoneFromConnection(connection, accountId);

      // 推送 NATS
      try {
        const nats = require("../../config/nats");
        await nats.publishMessage("connection", {
          accountId: accountId,
          accountPhone: phone,
          accountStatus: "normal",
          socketStatus: "connected",
          updatedAt: new Date().toISOString(),
        });
        logger.info(`[连接池] ✅ connection 事件已推送 (phone: ${phone})`);
      } catch (natsErr) {
        logger.error(`[连接池] ❌ 推送失败 (phone: ${phone})`, natsErr);
      }

      this.connections.set(accountId, {
        connection,
        lastUsed: Date.now(),
        createdAt: Date.now(),
        accountId,
        phone,
      });

      logger.info(`[连接池] 创建连接: ${phone}，当前: ${this.connections.size}/${this.maxSize}`);

      return connection;
    } catch (error) {
      logger.error(`[连接池] 创建连接失败 (accountId: ${accountId})`, error);
      throw error;
    }
  }

  // ========== 释放连接（仅云控调用） ==========
  release(accountId) {
    if (this.connections.has(accountId)) {
      const entry = this.connections.get(accountId);
      const phone = entry?.phone || accountId;
      this.connections.delete(accountId);

      // ========== 推送断开状态 ==========
      try {
        const nats = require("../../config/nats");
        nats.publishMessage("connection", {
          accountId: accountId,
          accountPhone: phone,
          socketStatus: "connected",
          accountStatus: "offline",
          updatedAt: new Date().toISOString(),
        });
        logger.info(`[连接池] ✅ 断开通知已推送 (phone: ${phone})`);
      } catch (err) {
        logger.error(`[连接池] ❌ 推送失败 (phone: ${phone})`, err);
      }

      logger.info(`[连接池] 释放连接: ${phone}，当前: ${this.connections.size}/${this.maxSize}`);
      return true;
    }
    return false;
  }

  // ========== 获取连接池大小 ==========
  size() {
    return this.connections.size;
  }

  // ========== 检查连接是否存在 ==========
  has(accountId) {
    return this.connections.has(accountId);
  }

  // ========== 获取连接 ==========
  get(accountId) {
    return this.connections.get(accountId)?.connection || null;
  }

  // ========== 清理空闲连接（只记录，不断开） ==========
  evictIdle() {
    const now = Date.now();
    let idleCount = 0;

    for (const [accountId, entry] of this.connections) {
      if (now - entry.lastUsed > this.idleTimeout) {
        idleCount++;
        const phone = entry?.phone || accountId;
        logger.info(`[连接池] 空闲连接: ${phone}，已闲置 ${(now - entry.lastUsed) / 60000} 分钟`);
      }
    }

    if (idleCount > 0) {
      logger.info(`[连接池] 共 ${idleCount} 个空闲连接，保持连接状态`);
    }

    return 0;
  }

  // ========== 清空所有连接 ==========
  async clear() {
    logger.info(`[连接池] 清空所有连接...`);
    for (const [accountId, entry] of this.connections) {
      try {
        const sock = entry.connection;
        const phone = entry?.phone || accountId;
        if (sock && sock.end) {
          await sock.end();
        }
        logger.info(`[连接池] 已关闭连接: ${phone}`);
      } catch (error) {
        logger.error(`[连接池] 关闭连接失败: ${accountId}`, error);
      }
    }
    this.connections.clear();
    logger.info(`[连接池] 清空完成`);
  }

  // ========== 手动设置连接 ==========
  set(accountId, sock) {
    const phone = this._getPhoneFromConnection(sock, accountId);
    this.connections.set(accountId, {
      connection: sock,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      accountId: accountId,
      phone: phone,
    });
    logger.info(`[连接池] 添加连接: ${phone}，当前: ${this.connections.size}/${this.maxSize}`);
  }

  // ========== 检查连接健康状态 ==========
  isHealthy(accountId) {
    const entry = this.connections.get(accountId);
    if (!entry) return false;
    const sock = entry.connection;
    return sock && sock.user && sock.user.id;
  }
}

module.exports = ConnectionPool;
