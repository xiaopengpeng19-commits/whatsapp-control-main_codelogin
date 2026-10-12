// src/services/baileys/connection-handler.js

const { Boom } = require("@hapi/boom");
const { DisconnectReason } = require("@whiskeysockets/baileys");
const { LOGIN_STATUS } = require("./constants");
const { cleanupSession, releaseSock } = require("./utils");
const redisStorage = require("../redisStorage");
const { conn } = require("../../utils/logger");
const logger = conn;
const { getClient } = require("../../config/redis");

// ========== 云控通知 ==========
async function notifyCloud(accountId, phoneNumber, socketStatus, accountStatus) {
  try {
    const nats = require("../../config/nats");
    await nats.publishMessage("connection", {
      accountId: phoneNumber || accountId,
      accountPhone: phoneNumber,
      socketStatus: socketStatus,
      accountStatus: accountStatus,
      updatedAt: new Date().toISOString(),
    });
    logger.info(`[${phoneNumber || accountId}] 状态已推送给云控: ${socketStatus}`);
  } catch (error) {
    logger.error(`[${phoneNumber || accountId}] 推送失败:`, error);
  }
}

// ========== 更新账号状态 ==========
async function updateAccountStatus(accountId, phoneNumber, accountStatus, socketStatus) {
  try {
    if (!phoneNumber && !accountId) return;

    const accountData = {
      id: accountId || phoneNumber,
      phoneNumber: phoneNumber || null,
      socket_status: socketStatus,
      account_status: accountStatus,
      lastActive: new Date().toISOString(),
    };

    const key = accountId || phoneNumber;
    const existing = await redisStorage.getAccountById(key);

    if (existing) {
      await redisStorage.updateAccount(key, accountData);
    } else {
      // ★ 没号码不创建（防止孤儿）
      if (!phoneNumber) {
        logger.debug(`[updateAccountStatus] 跳过：无 phoneNumber (id=${accountId})`);
        return;
      }
      await redisStorage.upsertAccount(accountData);
    }
  } catch (error) {
    logger.error(`[updateAccountStatus] 失败: accountId=${accountId}`, error);
  }
}

// ========== 二维码模式 ==========
function handleQRCode(sock, account, qr, ctx) {
  const { accountId, resolveFunc } = ctx;
  logger.info(`[${account.phoneNumber || accountId}] QR码已生成`);
  updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_QR, "disconnected");
  if (resolveFunc && typeof resolveFunc === "function") {
    resolveFunc({ status: "waiting_qr", qr, accountId, sock });
  }
}

// ========== 连接关闭 ==========
async function handleConnectionClose(sock, account, lastDisconnect, ctx) {
  const { accountId, resolveFunc, rejectFunc, usePairCode, onConnected, connectionPool } = ctx;

  const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error?.output?.statusCode : null;
  const isManualClose = sock._manualClose === true;
  const poolKey = account.phoneNumber ? String(account.phoneNumber) : String(accountId);

  logger.info(`[${account.phoneNumber || accountId}] ========== 连接关闭 ==========`);
  logger.info(`[${account.phoneNumber || accountId}] statusCode: ${statusCode}`);
  logger.info(`[${account.phoneNumber || accountId}] isManualClose: ${isManualClose}`);
  logger.info(`[${account.phoneNumber || accountId}] error: ${lastDisconnect?.error?.message || "无"}`);

  if (sock._closeHandled) {
    return;
  }
  sock._closeHandled = true;

  // 手动关闭
  if (isManualClose) {
    if (connectionPool && connectionPool.has(poolKey)) {
      await connectionPool.releaseAndClose(poolKey, `[${account.phoneNumber || accountId}] 手动关闭`);
    }
    logger.info(`[${account.phoneNumber || accountId}] 手动关闭连接`);
    if (rejectFunc && typeof rejectFunc === "function") {
      const err = new Error("手动关闭");
      err.code = 200;
      err.type = "MANUAL_CLOSE";
      rejectFunc(err);
    }
    return;
  }

  // 515 重启
  if (statusCode === 515) {
    logger.info(`[${account.phoneNumber || accountId}] 配对码登录成功，需要重启连接 (515)`);
    const { createConnection } = require("./connect");
    createConnection(account, onConnected, false)
      .then((result) => {
        if (result?.status === "connected") {
          if (resolveFunc && typeof resolveFunc === "function") {
            resolveFunc(result);
          }
        } else {
          if (rejectFunc && typeof rejectFunc === "function") {
            const err = new Error("重启连接失败");
            err.code = 500;
            err.type = "RESTART_FAILED";
            rejectFunc(err);
          }
        }
      })
      .catch((err) => {
        if (rejectFunc && typeof rejectFunc === "function") {
          err.code = err.code || 500;
          err.type = err.type || "RESTART_ERROR";
          rejectFunc(err);
        }
      });
    return;
  }

  // 401/403：凭证失效
  if (statusCode === 401 || statusCode === 403) {
    const statusMsg = statusCode === 401 ? "expired" : "banned";
    const statusText = statusCode === 401 ? "凭证过期" : "账号封禁";

    logger.warn(`[${account.phoneNumber || accountId}] ${statusText} (${statusCode})`);

    notifyCloud(accountId, account.phoneNumber, "disconnected", statusMsg);

    // 写 Redis
    try {
      await updateAccountStatus(accountId, account.phoneNumber, statusMsg, "disconnected");
    } catch (e) {}

    // 释放 sock
    try {
      await releaseSock(sock, `[${account.phoneNumber || accountId}] ${statusText} ${statusCode}`);
    } catch (e) {}

    if (connectionPool && connectionPool.has(poolKey)) {
      await connectionPool.releaseAndClose(poolKey, `[${account.phoneNumber || accountId}] ${statusText}`);
    }

    if (rejectFunc && typeof rejectFunc === "function") {
      const err = new Error(`${statusText}，请重新登录 (${statusCode})`);
      err.code = statusCode;
      err.type = "CREDENTIALS_EXPIRED";
      rejectFunc(err);
    }
    return;
  }

  // 其他错误
  logger.warn(`[${account.phoneNumber || accountId}] 连接断开 (statusCode: ${statusCode})`);
  notifyCloud(accountId, account.phoneNumber, "connected", "failed");

  try {
    await releaseSock(sock, `[${account.phoneNumber || accountId}] 连接断开 statusCode=${statusCode}`);
  } catch (e) {}

  if (connectionPool && connectionPool.has(poolKey)) {
    await connectionPool.releaseAndClose(poolKey, `[${account.phoneNumber || accountId}] 连接断开`);
  }

  if (rejectFunc && typeof rejectFunc === "function") {
    const err = new Error(`连接断开: ${lastDisconnect?.error?.message || "网络异常"}`);
    err.code = statusCode || 500;
    err.type = "CONNECTION_LOST";
    rejectFunc(err);
  }
}

// ========== 连接打开 ==========
function handleConnectionOpen(sock, account, ctx) {
  const { accountId, resolveFunc, onConnected, connectionPool } = ctx;

  sock._manualClose = false;
  sock._closeHandled = false;

  let phoneNumber = account.phoneNumber;
  if (!phoneNumber && sock.user?.id) {
    const match = sock.user.id.match(/^(\d+)/);
    phoneNumber = match ? match[1] : sock.user.id.split(":")[0]?.split("@")[0];
  }
  account.phoneNumber = phoneNumber;

  sock.account_status = LOGIN_STATUS.CONNECTED;
  sock.lastActiveTime = new Date();

  // ★ 池 key 用号码
  const poolKey = phoneNumber ? String(phoneNumber) : String(accountId);
  const isNewConnection = !connectionPool.has(poolKey);

  updateAccountStatus(accountId, phoneNumber, LOGIN_STATUS.CONNECTED, "connected");
  connectionPool.set(poolKey, sock);

  logger.info(`[${phoneNumber || accountId}] WhatsApp 连接成功: ${phoneNumber}`);

  if (isNewConnection) {
    notifyCloud(accountId, phoneNumber, "connected", "normal");
    logger.info(`[${phoneNumber || accountId}] 新连接上线通知已推送`);
  }

  if (onConnected) {
    onConnected(sock).catch((err) => logger.error(`[${phoneNumber || accountId}] 回调执行失败:`, err));
  }

  if (resolveFunc && typeof resolveFunc === "function") {
    resolveFunc({
      status: "connected",
      sock,
      accountId,
      phoneNumber: account.phoneNumber,
    });
  }
}

// ========== 事件分发 ==========
function createConnectionHandler(sock, account, ctx) {
  const { usePairCode } = ctx;
  let resolved = false;

  return (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairCode) {
      if (resolved) return;
      resolved = true;
      return handleQRCode(sock, account, qr, ctx);
    }

    if (connection === "close") {
      return handleConnectionClose(sock, account, lastDisconnect, ctx);
    }

    if (connection === "open") {
      return handleConnectionOpen(sock, account, ctx);
    }
  };
}

// ========== 配对码缓存（保留，给配对码登录用）==========
async function getCachedPairCode(phoneNumber) {
  const key = `paircode:${phoneNumber}`;
  try {
    const client = getClient();
    const cached = await client.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    logger.error(`[getCachedPairCode] 获取缓存失败:`, error);
  }
  return null;
}

async function setCachedPairCode(phoneNumber, code) {
  const key = `paircode:${phoneNumber}`;
  try {
    const client = getClient();
    await client.setEx(key, 300, JSON.stringify({ code, createdAt: Date.now() }));
  } catch (error) {
    logger.error(`[setCachedPairCode] 设置缓存失败:`, error);
  }
}

module.exports = {
  updateAccountStatus,
  createConnectionHandler,
};
