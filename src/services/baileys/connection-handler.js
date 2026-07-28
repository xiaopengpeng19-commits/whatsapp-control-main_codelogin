// src/services/baileys/connection-handler.js
const { Boom } = require("@hapi/boom");
const { DisconnectReason } = require("@whiskeysockets/baileys");
const { LOGIN_STATUS } = require("./constants");
const { cleanupSession } = require("./utils");
const redisStorage = require("../redisStorage");
const { conn } = require("../../utils/logger");
const logger = conn;

async function updateAccountStatus(
  accountId,
  phoneNumber,
  accountStatus,
  socketStatus,
) {
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

// src/services/baileys/connection-handler.js

function handlePairCode(sock, account, ctx) {
  const { accountId, resolveFunc, rejectFunc } = ctx;
  const phoneNumber = account.phoneNumber;

  // ========== 防御性检查 ==========
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

  logger.info(`[${accountId}] 开始请求配对码，手机号: ${phoneNumber}`);

  sock
    .requestPairingCode(phoneNumber)
    .then((code) => {
      logger.info(`[${accountId}] 配对码生成成功: ${code}`);

      // 更新账号状态
      updateAccountStatus(
        accountId,
        account.phoneNumber,
        LOGIN_STATUS.WAITING_PAIR_CODE,
        "disconnected",
      );

      // 返回配对码
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
      updateAccountStatus(
        accountId,
        account.phoneNumber,
        LOGIN_STATUS.FAILED,
        "disconnected",
      );

      if (rejectFunc && typeof rejectFunc === "function") {
        rejectFunc(err);
      }
    });
}

function handleQRCode(sock, account, qr, ctx) {
  const { accountId, resolveFunc } = ctx;
  logger.info(`[${accountId}] QR码已生成`);
  updateAccountStatus(
    accountId,
    account.phoneNumber,
    LOGIN_STATUS.WAITING_QR,
    "disconnected",
  );
  resolveFunc({ status: "waiting_qr", qr, accountId });
}

// src/services/baileys/connection-handler.js

function handleConnectionClose(sock, account, lastDisconnect, ctx) {
  const { accountId, resolveFunc, rejectFunc, usePairCode, onConnected } = ctx;
  const statusCode =
    lastDisconnect?.error instanceof Boom
      ? lastDisconnect.error?.output?.statusCode
      : null;
  const isManualClose = sock._manualClose === true;

  // ========== 确保 rejectFunc 存在 ==========
  if (!rejectFunc || typeof rejectFunc !== "function") {
    logger.error(`[${accountId}] rejectFunc 无效，跳过错误处理`);
    return;
  }

  // 手动关闭
  if (isManualClose) {
    logger.info(`[${accountId}] 手动关闭连接`);
    ctx.connections.delete(accountId);
    rejectFunc(new Error("手动关闭"));
    return;
  }

  // 515 重启
  if (statusCode === 515) {
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
          rejectFunc(new Error("重启连接失败"));
        }
      })
      .catch((err) => rejectFunc(err));
    return;
  }

  // 其他错误
  const status =
    statusCode === 403 || statusCode === 401
      ? LOGIN_STATUS.BANNED
      : LOGIN_STATUS.EXPIRED;

  if (statusCode === 403 || statusCode === 401) {
    sock.socket_status = "disconnected";
  }

  updateAccountStatus(
    accountId,
    account.phoneNumber,
    status,
    sock.socket_status || "connected",
  );
  cleanupSession(accountId);
  ctx.connections.delete(accountId);

  rejectFunc(
    new Error(`连接关闭: ${lastDisconnect?.error?.message || "未知错误"}`),
  );
}

function handleConnectionOpen(sock, account, ctx) {
  const { accountId, resolveFunc, onConnected, connections } = ctx;

  sock._manualClose = false;

  let phoneNumber = account.phoneNumber;
  if (!phoneNumber && sock.user?.id) {
    const match = sock.user.id.match(/^(\d+)/);
    phoneNumber = match ? match[1] : sock.user.id.split(":")[0]?.split("@")[0];
  }
  account.phoneNumber = phoneNumber;

  sock.account_status = LOGIN_STATUS.CONNECTED;
  sock.lastActiveTime = new Date();

  updateAccountStatus(
    accountId,
    phoneNumber,
    LOGIN_STATUS.CONNECTED,
    "connected",
  );
  connections.set(accountId, sock);

  logger.info(`[${accountId}] WhatsApp 连接成功: ${phoneNumber}`);

  if (onConnected) {
    onConnected(sock).catch((err) =>
      logger.error(`[${accountId}] 回调执行失败:`, err),
    );
  }

  resolveFunc({
    status: "connected",
    sock,
    accountId,
    phoneNumber: account.phoneNumber,
  });
}

function createConnectionHandler(sock, account, ctx) {
  const { usePairCode } = ctx;
  return (update) => {
    const { connection, lastDisconnect, qr } = update;
    logger.debug(`[${ctx.accountId}] 连接更新:`, update);

    if (qr && usePairCode && !sock.authState.creds.registered) {
      return handlePairCode(sock, account, qr, ctx);
    }
    if (qr && !usePairCode) {
      return handleQRCode(sock, account, qr, ctx);
    }
    if (connection === "close") {
      return handleConnectionClose(sock, account, lastDisconnect, ctx);
    }
    if (connection === "open") {
      // console.log('========== sock 完整结构 ==========');
      // console.log(Object.keys(sock));
      // console.log('sock.ws:', sock.ws);
      // if (sock.ws) {
      //   console.log('sock.ws keys:', Object.keys(sock.ws));
      //   console.log('sock.ws._socket:', sock.ws._socket);
      // }

      return handleConnectionOpen(sock, account, ctx);
    }
  };
}

module.exports = {
  updateAccountStatus,
  createConnectionHandler,
};
