// src/services/baileys/connection-pool.js

const logger = require("../../utils/logger").conn;

class ConnectionPool {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 150;
    this.minSize = options.minSize || 10;
    this.idleTimeout = options.idleTimeout || 30 * 60 * 1000;
    this.connections = new Map(); // key = phoneNumber
    this.isShuttingDown = false;
  }

  // ========== 从连接中提取手机号 ==========
  _getPhoneFromConnection(connection, fallbackKey) {
    try {
      let phone = fallbackKey;
      if (connection?.user?.id) {
        phone = connection.user.id.split("@")[0].split(":")[0];
      } else if (connection?.auth?.creds?.me?.id) {
        phone = connection.auth.creds.me.id.split("@")[0].split(":")[0];
      }
      if (phone && !/^\d+$/.test(phone)) {
        const match = phone.match(/\d+/);
        if (match) phone = match[0];
      }
      return phone || fallbackKey;
    } catch {
      return fallbackKey;
    }
  }

  // ========== 获取连接 ==========
  async acquire(phoneNumber, createFn) {
    if (this.connections.has(phoneNumber)) {
      const entry = this.connections.get(phoneNumber);
      entry.lastUsed = Date.now();
      return entry.connection;
    }

    if (this.connections.size >= this.maxSize) {
      const error = new Error(`连接池已满 (${this.maxSize}/${this.maxSize})，请稍后重试`);
      error.code = "POOL_FULL";
      logger.warn(`[连接池] 拒绝连接: ${phoneNumber}，已达上限 ${this.maxSize}`);
      throw error;
    }

    return this._createConnection(phoneNumber, createFn);
  }

  // ========== 创建连接 ==========
  async _createConnection(phoneNumber, createFn) {
    try {
      const connection = await createFn();
      const phone = this._getPhoneFromConnection(connection, phoneNumber);

      this.connections.set(phoneNumber, {
        connection,
        lastUsed: Date.now(),
        createdAt: Date.now(),
        accountId: phoneNumber,
        phone,
      });

      logger.info(`[连接池] 创建连接: ${phone}，当前: ${this.connections.size}/${this.maxSize}`);
      return connection;
    } catch (error) {
      logger.error(`[连接池] 创建连接失败 (key: ${phoneNumber})`, error);
      throw error;
    }
  }

  // ========== 释放条目（不关 sock） ==========
  release(phoneNumber) {
    if (this.connections.has(phoneNumber)) {
      const entry = this.connections.get(phoneNumber);
      const phone = entry?.phone || phoneNumber;
      this.connections.delete(phoneNumber);

      try {
        const nats = require("../../config/nats");
        nats.publishMessage("connection", {
          accountId: phone,
          accountPhone: phone,
          socketStatus: "connected",
          accountStatus: "offline",
          updatedAt: new Date().toISOString(),
        });
        logger.info(`[连接池] 断开通知已推送 (phone: ${phone})`);
      } catch (err) {
        logger.error(`[连接池] 推送失败 (phone: ${phone})`, err);
      }

      logger.info(`[连接池] 释放条目: ${phone}，当前: ${this.connections.size}/${this.maxSize}`);
      return true;
    }
    return false;
  }

  // ========== 释放并关闭 sock ==========
  async releaseAndClose(phoneNumber, reason = "") {
    const entry = this.connections.get(phoneNumber);
    if (!entry) return false;

    const phone = entry?.phone || phoneNumber;
    const sock = entry?.connection;
    this.connections.delete(phoneNumber);

    // 推 NATS
    try {
      const nats = require("../../config/nats");
      nats.publishMessage("connection", {
        accountId: phone,
        accountPhone: phone,
        socketStatus: "disconnected",
        accountStatus: "offline",
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {}

    // 关 sock + 切引用环
    if (sock) {
      try {
        const { releaseSock } = require("./utils");
        await releaseSock(sock, reason || `[连接池] releaseAndClose ${phone}`);
      } catch (e) {}
    }

    logger.info(`[连接池] 释放并关闭: ${phone}，当前: ${this.connections.size}/${this.maxSize}`);
    return true;
  }

  size() {
    return this.connections.size;
  }

  has(phoneNumber) {
    return this.connections.has(phoneNumber);
  }

  get(phoneNumber) {
    return this.connections.get(phoneNumber)?.connection || null;
  }

  // ========== 清理空闲连接（只记录，不断开） ==========
  evictIdle() {
    const now = Date.now();
    let idleCount = 0;

    for (const [, entry] of this.connections) {
      if (now - entry.lastUsed > this.idleTimeout) {
        idleCount++;
        const phone = entry?.phone || entry?.accountId;
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
    const { releaseSock } = require("./utils");
    for (const [phoneNumber, entry] of this.connections) {
      try {
        const sock = entry.connection;
        const phone = entry?.phone || phoneNumber;
        if (sock) {
          await releaseSock(sock, `[连接池] clear ${phone}`);
        }
        logger.info(`[连接池] 已释放连接: ${phone}`);
      } catch (error) {
        logger.error(`[连接池] 释放连接失败: ${phoneNumber}`, error);
      }
    }
    this.connections.clear();
    logger.info(`[连接池] 清空完成`);
  }

  // ========== 手动设置连接 ==========
  set(phoneNumber, sock) {
    const phone = this._getPhoneFromConnection(sock, phoneNumber);
    this.connections.set(phoneNumber, {
      connection: sock,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      accountId: phoneNumber,
      phone: phone,
    });
    logger.info(`[连接池] 添加连接: ${phone}，当前: ${this.connections.size}/${this.maxSize}`);
  }

  // ========== 健康检查 ==========
  isHealthy(phoneNumber) {
    const entry = this.connections.get(phoneNumber);
    if (!entry) return false;
    const sock = entry.connection;
    return sock && sock.user && sock.user.id;
  }
}

module.exports = ConnectionPool;
