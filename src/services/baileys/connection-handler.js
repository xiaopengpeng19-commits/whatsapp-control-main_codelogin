// src/services/baileys/connection-handler.js
const { Boom } = require("@hapi/boom");
const { DisconnectReason } = require("@whiskeysockets/baileys");
const { LOGIN_STATUS } = require("./constants");
const { cleanupSession } = require("./utils");
const redisStorage = require("../redisStorage");
const { conn } = require("../../utils/logger");
const logger = conn;

async function updateAccountStatus(accountId, phoneNumber, accountStatus, socketStatus) {
  try {
    const accountData = {
      id: accountId,
      phoneNumber: phoneNumber || null,
      socket_status: socketStatus,
      account_status: accountStatus,
      lastActive: new Date().toISOString(),
    };
    const existing = await redisStorage.getAccountById(accountId);
    if (existing) {
      await redisStorage.updateAccount(accountId, accountData);
    } else {
      await redisStorage.upsertAccount(accountData);
    }
  } catch (error) {
    logger.error(`[${accountId}] 更新账号状态失败:`, error);
  }
}

// ========== 配对码模式：收到 qr 后请求配对码 ==========
function handleQRCodeForPairing(sock, account, ctx) {
  const { accountId, resolveFunc, rejectFunc } = ctx;
  const phoneNumber = account.phoneNumber;

  logger.info(`[${accountId}] QR码已生成，准备请求配对码`);

  if (!phoneNumber) {
    logger.error(`[${accountId}] 配对码登录失败: 手机号为空`);
    if (rejectFunc && typeof rejectFunc === "function") {
      rejectFunc(new Error("配对码登录需要提供手机号"));
    }
    return;
  }

  if (!rejectFunc || typeof rejectFunc !== "function") {
    logger.error(`[${accountId}] rejectFunc 无效，无法处理配对码请求`);
    return;
  }

  sock
    .requestPairingCode(phoneNumber)
    .then((code) => {
      logger.info(`[${accountId}] 配对码生成成功: ${code}`);

      updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_PAIR_CODE, "disconnected");

      if (resolveFunc && typeof resolveFunc === "function") {
        resolveFunc({
          status: "waiting_pair_code",
          code,
          accountId,
          phoneNumber: account.phoneNumber,
        });
      } else {
        logger.error(`[${accountId}] resolveFunc 无效，无法返回配对码`);
      }
    })
    .catch((err) => {
      logger.error(`[${accountId}] 请求配对码失败:`, err);
      sock.account_status = LOGIN_STATUS.FAILED;
      updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.FAILED, "disconnected");

      if (rejectFunc && typeof rejectFunc === "function") {
        rejectFunc(err);
      }
    });
}

// ========== 二维码模式：直接返回 qr ==========
function handleQRCode(sock, account, qr, ctx) {
  const { accountId, resolveFunc } = ctx;
  logger.info(`[${accountId}] QR码已生成`);
  updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_QR, "disconnected");
  if (resolveFunc && typeof resolveFunc === "function") {
    resolveFunc({ status: "waiting_qr", qr, accountId });
  }
}

function handleConnectionClose(sock, account, lastDisconnect, ctx) {
  const { accountId, resolveFunc, rejectFunc, usePairCode, onConnected } = ctx;

  if (ctx._resolved) {
    logger.debug(`[${accountId}] 连接已处理，跳过重复关闭事件`);
    return;
  }

  const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error?.output?.statusCode : null;
  const isManualClose = sock._manualClose === true;

  // ========== 手动关闭 ==========
  if (isManualClose) {
    logger.info(`[${accountId}] 手动关闭连接`);
    ctx.connections.delete(accountId);
    if (rejectFunc && typeof rejectFunc === "function") {
      const err = new Error("手动关闭");
      err.code = 200;
      err.type = "MANUAL_CLOSE";
      rejectFunc(err);
    }
    return;
  }

  // ========== 515 重启 ==========
  if (statusCode === 515) {
    ctx._resolved = true;
    logger.info(`[${accountId}] 配对码登录成功，需要重启连接 (515)`);
    const { createConnection } = require("./connect");
    createConnection(account, onConnected, true)
      .then((result) => {
        if (result?.status === "connected") {
          ctx.connections.set(accountId, result.sock);
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

  // ========== 401/403：凭证失效，彻底清理 ==========
  if (statusCode === 401 || statusCode === 403) {
    logger.warn(`[${accountId}] 凭证已失效 (${statusCode})，彻底清理账号数据`);

    setImmediate(async () => {
      try {
        const redisStorage = require("../redisStorage");
        await redisStorage.deleteAccount(accountId);
        logger.info(`[${accountId}] 已从 Redis 删除`);

        const sessionDir = path.join(process.env.STORAGE_PATH || "./storage/sessions", String(accountId));
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          logger.info(`[${accountId}] 已删除会话目录: ${sessionDir}`);
        }
      } catch (error) {
        logger.error(`[${accountId}] 清理账号数据失败:`, error);
      }
    });

    ctx.connections.delete(accountId);
    if (rejectFunc && typeof rejectFunc === "function") {
      // ========== 使用自定义错误对象 ==========
      const err = new Error(`凭证已失效，请重新登录 (${statusCode})`);
      err.code = statusCode; // 401 或 403
      err.type = "CREDENTIALS_EXPIRED";
      rejectFunc(err);
    }
    return;
  }

  // ========== 其他错误（网络超时、代理故障等） ==========
  logger.warn(`[${accountId}] 连接断开 (statusCode: ${statusCode})，保留账号状态，等待重试`);

  ctx.connections.delete(accountId);

  if (rejectFunc && typeof rejectFunc === "function") {
    const err = new Error(`连接断开: ${lastDisconnect?.error?.message || "网络异常"}`);
    err.code = statusCode || 500;
    err.type = "CONNECTION_LOST";
    rejectFunc(err);
  }
}

function handleConnectionOpen(sock, account, ctx) {
  const { accountId, resolveFunc, onConnected, connections } = ctx;

  // ========== 防止重复处理 ==========
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
  connections.set(accountId, sock);

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

function createConnectionHandler(sock, account, ctx) {
  const { usePairCode } = ctx;
  return (update) => {
    const { connection, lastDisconnect, qr } = update;
    logger.debug(`[${ctx.accountId}] 连接更新:`, update);

    // ========== 配对码模式：收到 qr 后请求配对码 ==========
    if (qr && usePairCode) {
      return handleQRCodeForPairing(sock, account, ctx);
    }

    // ========== 二维码模式：直接返回 qr ==========
    if (qr && !usePairCode) {
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

module.exports = {
  updateAccountStatus,
  createConnectionHandler,
};
