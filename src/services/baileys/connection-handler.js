// src/services/baileys/connection-handler.js

const { Boom } = require("@hapi/boom");
const { DisconnectReason } = require("@whiskeysockets/baileys");
const { LOGIN_STATUS } = require("./constants");
const { cleanupSession } = require("./utils");
const redisStorage = require("../redisStorage");
const { conn } = require("../../utils/logger");
const logger = conn;
const { getClient } = require("../../config/redis");

async function updateAccountStatus(accountId, phoneNumber, accountStatus, socketStatus) {
  try {
    logger.info(
      `[updateAccountStatus] 开始更新账号状态: accountId=${accountId}, phoneNumber=${phoneNumber}, accountStatus=${accountStatus}, socketStatus=${socketStatus}`,
    );

    const accountData = {
      id: accountId,
      phoneNumber: phoneNumber || null,
      socket_status: socketStatus,
      account_status: accountStatus,
      lastActive: new Date().toISOString(),
    };

    const existing = await redisStorage.getAccountById(accountId);
    logger.info(`[updateAccountStatus] 账号是否存在: ${!!existing}`);

    if (existing) {
      await redisStorage.updateAccount(accountId, accountData);
      logger.info(`[updateAccountStatus] 账号已更新: ${accountId}`);
    } else {
      await redisStorage.upsertAccount(accountData);
      logger.info(`[updateAccountStatus] 账号已创建: ${accountId}`);
    }

    logger.info(`[updateAccountStatus] 更新完成: accountId=${accountId}, accountStatus=${accountStatus}, socketStatus=${socketStatus}`);
  } catch (error) {
    logger.error(`[updateAccountStatus] 更新账号状态失败: accountId=${accountId}`, error);
  }
}

// ========== 二维码模式 ==========
function handleQRCode(sock, account, qr, ctx) {
  const { accountId, resolveFunc } = ctx;
  logger.info(`[${account.phoneNumber}] QR码已生成`);
  updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_QR, "disconnected");
  if (resolveFunc && typeof resolveFunc === "function") {
    resolveFunc({ status: "waiting_qr", qr, accountId });
  }
}

// ========== 连接关闭 ==========
function handleConnectionClose(sock, account, lastDisconnect, ctx) {
  const { accountId, resolveFunc, rejectFunc, usePairCode, onConnected, connectionPool } = ctx;

  if (ctx._resolved) {
    logger.debug(`[${accountId}] 连接已处理，跳过重复关闭事件`);
    return;
  }

  const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error?.output?.statusCode : null;
  const isManualClose = sock._manualClose === true;

  // 手动关闭
  if (isManualClose) {
    logger.info(`[${accountId}] 手动关闭连接`);
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
    ctx._resolved = true;
    logger.info(`[${accountId}] 配对码登录成功，需要重启连接 (515)`);
    const { createConnection } = require("./connect");
    createConnection(account, onConnected, true)
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
    logger.warn(`[${accountId}] 凭证已失效 (${statusCode})，彻底清理账号数据`);

    setImmediate(async () => {
      try {
        const redisStorage = require("../redisStorage");
        await redisStorage.deleteAccount(accountId);
        logger.info(`[${accountId}] 已从 Redis 删除`);
        const sessionDir = require("path").join(process.env.STORAGE_PATH || "./storage/sessions", String(accountId));
        const fs = require("fs");
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          logger.info(`[${accountId}] 已删除会话目录: ${sessionDir}`);
        }
      } catch (error) {
        logger.error(`[${accountId}] 清理账号数据失败:`, error);
      }
    });

    if (rejectFunc && typeof rejectFunc === "function") {
      const err = new Error(`凭证已失效，请重新登录 (${statusCode})`);
      err.code = statusCode;
      err.type = "CREDENTIALS_EXPIRED";
      rejectFunc(err);
    }
    return;
  }

  // 其他错误
  logger.warn(`[${accountId}] 连接断开 (statusCode: ${statusCode})，保留账号状态，等待重试`);
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

  if (ctx._resolved) {
    logger.debug(`[${accountId}] 连接已处理，跳过重复打开事件`);
    return;
  }
  ctx._resolved = true;

  sock._manualClose = false;

  let phoneNumber = account.phoneNumber;
  if (!phoneNumber && sock.user?.id) {
    const match = sock.user.id.match(/^(\d+)/);
    phoneNumber = match ? match[1] : sock.user.id.split(":")[0]?.split("@")[0];
  }
  account.phoneNumber = phoneNumber;

  sock.account_status = LOGIN_STATUS.CONNECTED;
  sock.lastActiveTime = new Date();

  updateAccountStatus(accountId, phoneNumber, LOGIN_STATUS.CONNECTED, "connected");
  connectionPool.set(accountId, sock); // ✅ 使用 connectionPool

  logger.info(`[${accountId}] WhatsApp 连接成功: ${phoneNumber}`);

  if (onConnected) {
    onConnected(sock).catch((err) => logger.error(`[${accountId}] 回调执行失败:`, err));
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

// src/services/baileys/connection-handler.js

// connection-handler.js

function createConnectionHandler(sock, account, ctx) {
  const { usePairCode } = ctx;
  let resolved = false;

  return (update) => {
    const { connection, lastDisconnect, qr } = update;
    // if (usePairCode) {
    //   if (resolved) {
    //     logger.debug(`[${account.phoneNumber}] 已处理，忽略重复 qr`);
    //     return;
    //   }
    //   resolved = true;
    //   return handleQRCodeForPairing(sock, account, ctx);
    // }

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

// ========== 新增：Redis 缓存配对码 ==========
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
// ========== 修改 handleQRCodeForPairing ==========
function handleQRCodeForPairing(sock, account, ctx) {
  const { accountId, resolveFunc, rejectFunc } = ctx;
  const phoneNumber = String(account.phoneNumber);
  logger.info(`[${phoneNumber}] 请求匹配码`);
  // ========== 1. 先检查 Redis 缓存 ==========
  getCachedPairCode(phoneNumber)
    .then((cached) => {
      if (cached) {
        logger.info(`[${phoneNumber}] 使用缓存的配对码: ${cached.code}`);
        if (resolveFunc) {
          resolveFunc({
            status: "waiting_pair_code",
            code: cached.code,
            accountId,
            phoneNumber: account.phoneNumber,
          });
        }
        return;
      }

      // ========== 2. 没有缓存，请求新的 ==========
      sock
        .requestPairingCode(phoneNumber)
        .then((code) => {
          logger.info(`[${phoneNumber}] 配对码生成成功: ${code}`);

          // ========== 3. 存入 Redis，5 分钟过期 ==========
          setCachedPairCode(phoneNumber, code).catch((err) => {
            logger.error(`[${phoneNumber}] 缓存配对码失败:`, err);
          });

          if (resolveFunc) {
            resolveFunc({
              status: "waiting_pair_code",
              code,
              accountId,
              phoneNumber: account.phoneNumber,
            });
          }
        })
        .catch((err) => {
          logger.error(`[${phoneNumber}] 配对码请求失败:`, err);
          if (rejectFunc) {
            rejectFunc(err);
          }
        });
    })
    .catch((err) => {
      logger.error(`[${phoneNumber}] 检查缓存失败:`, err);
      // 缓存失败，直接请求
      sock
        .requestPairingCode(phoneNumber)
        .then((code) => {
          logger.info(`[${phoneNumber}] 配对码生成成功: ${code}`);
          setCachedPairCode(phoneNumber, code).catch(() => {});
          if (resolveFunc) {
            resolveFunc({
              status: "waiting_pair_code",
              code,
              accountId,
              phoneNumber: account.phoneNumber,
            });
          }
        })
        .catch((err) => {
          logger.error(`[${phoneNumber}] 配对码请求失败:`, err);
          if (rejectFunc) {
            rejectFunc(err);
          }
        });
    });
}

module.exports = {
  updateAccountStatus,
  createConnectionHandler,
};
