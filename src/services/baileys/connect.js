// src/services/baileys/connect.js
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
  makeCacheableSignalKeyStore,
  proto,
} = require("@whiskeysockets/baileys");
const { conn } = require("../../utils/logger");
const redisStorage = require("../redisStorage");
const nats = require("../../config/nats");
const snowflake = require("../../utils/snowflake");
const { getAccountSyncFlag, setAccountSyncFlag } = require("../redisStorage");
const {
  LOGIN_STATUS,
  groupCache,
  msgRetryCounterCache,
} = require("./constants");
const {
  getSessionDir,
  createProxyAgent,
  createBaileysLogger,
} = require("./utils");
const {
  createConnectionHandler,
  updateAccountStatus,
} = require("./connection-handler");
const {
  handleIncomingMessage,
  handleMessageStatusUpdate,
  handleMessageReceiptUpdate,
  handleMessagingHistory,
  handleChatsUpsert,
} = require("./message-handler");

const logger = conn;
const connections = new Map();

async function createConnection(
  account,
  onConnected = null,
  usePairCode = false,
) {
  const accountId = account.id;
  let resolveFunc, rejectFunc;

  const loginPromise = new Promise((resolve, reject) => {
    resolveFunc = resolve;
    rejectFunc = reject;
  });

  try {
    const sessionDir = getSessionDir(accountId);
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const proxyAgent = createProxyAgent(account.proxy);

    logger.info(`[${account.phoneNumber}] 使用 [${account.proxy}]`);

    // ==========================================
    // 创建 logger 实例，所有地方统一使用
    // ==========================================
    const baileysLogger = createBaileysLogger();

    // 添加 trace 方法（如果不存在）
    if (!baileysLogger.trace) {
      baileysLogger.trace = () => {};
    }

    // ========== 根据号码判断是否需要同步 ==========
    const hasSynced = account.phoneNumber
      ? await getAccountSyncFlag(account.phoneNumber)
      : false;

    const shouldSync = !hasSynced; // 只有未同步过的号码才同步

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger), // 改用 baileysLogger
      },
      agent: proxyAgent,
      fetchAgent: proxyAgent,
      shouldSyncHistoryMessage: () => shouldSync, // ← 启用历史同步
      syncFullHistory: shouldSync, // ← 同步全部历史
      msgRetryCounterCache,
      connectTimeoutMs: 60000,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
      retryRequestDelayMs: 1000,
      generateHighQualityLinkPreview: true,
      browser: Browsers.appropriate("WhatsApp"),
      getMessage: async (key) => {
        try {
          const stored = await redisStorage.getMessageById(key.id);
          if (stored?.message) {
            return typeof stored.message === "string"
              ? JSON.parse(stored.message)
              : stored.message;
          }
          return proto.Message.create({ conversation: "" });
        } catch (error) {
          baileysLogger.error(`[${accountId}] getMessage 失败:`, error); // 改用 baileysLogger
          return proto.Message.create({ conversation: "" });
        }
      },
    });

    sock.account_status = LOGIN_STATUS.CONNECTING;
    sock.lastActiveTime = new Date();

    const ctx = {
      accountId,
      resolveFunc,
      rejectFunc,
      retryCount,
      usePairCode,
      onConnected,
      saveCreds,
      connections,
    };
    const connectionHandler = createConnectionHandler(sock, account, ctx);

    sock.ev.process(async (events) => {
      console.log("触发事件:", Object.keys(events));

      if (events["creds.update"]) {
        await saveCreds();
        baileysLogger.debug(`[${accountId}] 凭证已保存`); // 改用 baileysLogger
      }

      if (events["connection.update"]) {
        connectionHandler(events["connection.update"]);
      }

      // connect.js - contacts.upsert 处理

      if (events["contacts.upsert"]) {
        const contacts = events["contacts.upsert"];
        logger.info(`[${accountId}] 联系人更新: ${contacts?.length || 0} 个`);

        for (const contact of contacts || []) {
          try {
            // ========== 根据实际结构提取字段 ==========
            const jid = contact.id || contact.phoneNumber;
            const phoneNumber = jid?.split("@")[0] || jid;
            const name = contact.name || contact.notify || phoneNumber;

            logger.info(`[${accountId}] 保存联系人: ${phoneNumber} (${name})`);

            await redisStorage.upsertChat({
              id: snowflake.nextId(),
              peerPhone: phoneNumber,
              peerId: jid,
              peerName: name,
              accountId: accountId,
              accountPhone: account.phoneNumber,
              isGroup: jid?.includes("g.us") || false,
              contactAdded: true,
            });

            logger.info(`[${accountId}] ✅ 联系人已保存: ${phoneNumber}`);
          } catch (error) {
            logger.error(`[${accountId}] ❌ 保存联系人失败:`, error);
          }
        }
      }

      if (events["messaging-history.set"]) {
        // 同步完成，标记该号码已同步
        if (account.phoneNumber) {
          await setAccountSyncFlag(account.phoneNumber, true);
          logger.info(
            `[${accountId}] 历史同步完成，已标记 ${account.phoneNumber}`,
          );
        }
        await handleMessagingHistory(events, accountId, account.phoneNumber);
      }

      if (events["messages.upsert"]) {
        const upsert = events["messages.upsert"];
        if (upsert.type === "notify" || upsert.type === "append") {
          sock.lastActiveTime = new Date();
          for (const msg of upsert.messages || []) {
            const text =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text;
            if (text === "requestPlaceholder" && !upsert.requestId) {
              await sock.requestPlaceholderResend(msg.key);
              continue;
            }
            if (text === "onDemandHistSync") {
              await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
              continue;
            }
            await handleIncomingMessage(
              sock,
              msg,
              accountId,
              account.phoneNumber,
            );
          }
        }
      }

      if (events["messages.update"]) {
        await handleMessageStatusUpdate(
          events["messages.update"],
          accountId,
          account.phoneNumber,
        );
      }

      if (events["message-receipt.update"]) {
        await handleMessageReceiptUpdate(
          events["message-receipt.update"],
          accountId,
          account.phoneNumber,
        );
      }

      if (events["chats.upsert"]) {
        await handleChatsUpsert(
          events["chats.upsert"],
          accountId,
          account.phoneNumber,
        );
      }

      if (events["groups.update"]) {
        for (const event of events["groups.update"] || []) {
          const metadata = await sock.groupMetadata(event.id);
          groupCache.set(event.id, metadata);
        }
      }

      if (events["group-participants.update"]) {
        for (const event of events["group-participants.update"] || []) {
          const metadata = await sock.groupMetadata(event.id);
          groupCache.set(event.id, metadata);
        }
      }
    });

    const timeoutDuration = usePairCode ? 60000 : 120000;
    const timeoutId = setTimeout(() => {
      baileysLogger.error(`[${accountId}] 登录超时`); // 改用 baileysLogger
      sock.account_status = LOGIN_STATUS.FAILED;
      updateAccountStatus(
        accountId,
        account.phoneNumber,
        LOGIN_STATUS.FAILED,
        "disconnected",
      );
      rejectFunc(new Error("登录超时"));
    }, timeoutDuration);

    const result = await loginPromise;
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    logger.error(`[${accountId}] 创建连接失败:`, error);
    return { status: "failed", error: error.message };
  }
}

// services/baileys/connect.js

async function getConnection(
  identifier,
  callback = null,
  proxyOverride = null,
) {
  // 1. 检查内存连接
  if (connections.has(identifier)) {
    const sock = connections.get(identifier);
    if (sock?.user) return sock;
    connections.delete(identifier);
  }

  // 2. 从 Redis 获取账号
  const accountService = require("../account");
  const account = await accountService.getAccountByPhoneNumberOrId(identifier);
  if (!account) {
    logger.error(`[${identifier}] 账号不存在`);
    return null;
  }

  // 3. 如果传入了 proxyOverride，覆盖 account.proxy
  if (proxyOverride) {
    account.proxy = proxyOverride;
  }

  // 4. 检查内存连接（用 account.id）
  if (connections.has(account.id)) return connections.get(account.id);

  // 5. 创建新连接
  const result = await createConnection(account, callback);
  return result?.status === "connected" ? result.sock : null;
}

async function closeConnection(accountId) {
  if (connections.has(accountId)) {
    try {
      const sock = connections.get(accountId);
      sock._manualClose = true;
      await sock.end();
      connections.delete(accountId);
      logger.info(`[${accountId}] 连接已关闭`);
      return true;
    } catch (error) {
      logger.error(`[${accountId}] 关闭连接失败:`, error);
      connections.delete(accountId);
      return false;
    }
  }
  return false;
}

async function CloseConnection(idOrPhone) {
  if (connections.has(idOrPhone)) return await closeConnection(idOrPhone);
  const accountService = require("../account");
  const account = await accountService.getAccountByPhoneNumberOrId(idOrPhone);
  if (account && connections.has(account.id))
    return await closeConnection(account.id);
  logger.warn(`[${idOrPhone}] 未找到对应的活动连接`);
  return false;
}

function getConnectionStatus(accountId) {
  return connections.get(accountId)?.account_status || null;
}

function getAllConnections() {
  return connections;
}

async function intervalStopIdelConnection() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  let closedCount = 0;
  for (const [accountId, sock] of connections) {
    if (sock.lastActiveTime && sock.lastActiveTime < oneHourAgo) {
      await closeConnection(accountId);
      closedCount++;
    }
  }
  return closedCount;
}

/**
 * 发送重启通知到 NATS
 */
async function sendRestartNotification() {
  try {
    await nats.publishMessage("system.restart", {
      event: "service_restart",
      timestamp: new Date().toISOString(),
      message: "WhatsApp service has been restarted",
    });
    logger.info("✅ 重启通知已发送到 NATS");
  } catch (error) {
    logger.error("发送重启通知失败:", error);
  }
}

module.exports = {
  createConnection,
  getConnection,
  closeConnection,
  CloseConnection,
  getAllConnections,
  getConnectionStatus,
  intervalStopIdelConnection,
  sendRestartNotification,
  LOGIN_STATUS,
};
