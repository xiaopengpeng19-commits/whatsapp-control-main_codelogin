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
const { LOGIN_STATUS, groupCache, msgRetryCounterCache } = require("./constants");
const { getSessionDir, createProxyAgent, createBaileysLogger } = require("./utils");
const { createConnectionHandler, updateAccountStatus } = require("./connection-handler");
const {
  handleIncomingMessage,
  handleMessageStatusUpdate,
  handleMessageReceiptUpdate,
  handleMessagingHistory,
  handleChatsUpsert,
} = require("./message-handler");

const logger = conn;
const connections = new Map();

async function createConnection(account, onConnected = null, usePairCode = false) {
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

    const baileysLogger = createBaileysLogger();
    if (!baileysLogger.trace) {
      baileysLogger.trace = () => {};
    }

    const hasSynced = account.phoneNumber ? await getAccountSyncFlag(account.phoneNumber) : false;
    const shouldSync = !hasSynced;

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      reconnect: false, // ✅ 禁用自动重连
      maxReconnectAttempts: 0, // ✅ 不重试
      agent: proxyAgent,
      fetchAgent: proxyAgent,
      shouldSyncHistoryMessage: () => shouldSync,
      syncFullHistory: shouldSync,
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
            return typeof stored.message === "string" ? JSON.parse(stored.message) : stored.message;
          }
          return proto.Message.create({ conversation: "" });
        } catch (error) {
          baileysLogger.error(`[${accountId}] getMessage 失败:`, error);
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
      usePairCode,
      onConnected,
      saveCreds,
      connections,
      _resolved: false,
    };
    const connectionHandler = createConnectionHandler(sock, account, ctx);

    // src/services/baileys/connect.js

    sock.ev.process(async (events) => {
      const eventKeys = Object.keys(events);
      if (eventKeys.length > 0) {
        logger.info(`[${accountId}] 触发事件:`, eventKeys);
      }

      // 1. 凭证更新
      if (events["creds.update"]) {
        await saveCreds();
        baileysLogger.debug(`[${accountId}] 凭证已保存`);
      }

      // 2. 连接状态更新
      if (events["connection.update"]) {
        connectionHandler(events["connection.update"]);
      }

      // 3. 联系人更新（手机端添加联系人时触发）
      if (events["contacts.upsert"]) {
        const contacts = events["contacts.upsert"];
        logger.info(`[${accountId}] 联系人更新: ${contacts?.length || 0} 个`);

        for (const contact of contacts || []) {
          try {
            const jid = contact.id || contact.phoneNumber;
            const phoneNumber = jid?.split("@")[0] || jid;
            const name = contact.name || contact.notify || phoneNumber;

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

      // 4. 历史同步
      if (events["messaging-history.set"]) {
        if (account.phoneNumber) {
          await setAccountSyncFlag(account.phoneNumber, true);
          logger.info(`[${accountId}] 历史同步完成，已标记 ${account.phoneNumber}`);
        }
        await handleMessagingHistory(events, accountId, account.phoneNumber);
      }

      // 5. 新消息
      if (events["messages.upsert"]) {
        const upsert = events["messages.upsert"];

        // 打印完整数据（调试用）
        logger.info(`[${accountId}] messages.upsert 数据:`, JSON.stringify(upsert, null, 2));

        if (upsert.type === "notify" || upsert.type === "append") {
          sock.lastActiveTime = new Date();
          for (const msg of upsert.messages || []) {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

            // 特殊命令处理
            if (text === "requestPlaceholder" && !upsert.requestId) {
              await sock.requestPlaceholderResend(msg.key);
              continue;
            }
            if (text === "onDemandHistSync") {
              await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
              continue;
            }

            await handleIncomingMessage(sock, msg, accountId, account.phoneNumber);
          }
        }
      }

      // 6. 消息状态更新（已读/送达）
      if (events["messages.update"]) {
        await handleMessageStatusUpdate(events["messages.update"], accountId, account.phoneNumber);
      }

      // 7. 消息回执
      if (events["message-receipt.update"]) {
        await handleMessageReceiptUpdate(events["message-receipt.update"], accountId, account.phoneNumber);
      }

      // 9. 新聊天会话
      if (events["chats.upsert"]) {
        logger.info(`[${accountId}] chats.upsert 数据:`, JSON.stringify(events["chats.upsert"], null, 2));
        await handleChatsUpsert(events["chats.upsert"], accountId, account.phoneNumber);
      }

      // src/services/baileys/connect.js - 在 sock.ev.process 中添加

      // 群组成员变化
      if (events["group-participants.update"]) {
        const update = events["group-participants.update"];
        logger.info(`[${accountId}] group-participants.update:`, JSON.stringify(update, null, 2));

        await nats.publishMessage("group.event", {
          accountId: accountId,
          accountPhone: account.phoneNumber,
          eventType: "group.participants.update",
          data: {
            groupId: update.id,
            action: update.action,
            author: update.author,
            participants: update.participants,
          },
          timestamp: new Date().toISOString(),
        });
      }

      // 群组信息更新
      if (events["groups.update"]) {
        const updates = events["groups.update"];
        logger.info(`[${accountId}] groups.update:`, JSON.stringify(updates, null, 2));

        for (const update of updates) {
          await nats.publishMessage("group.event", {
            accountId: accountId,
            accountPhone: account.phoneNumber,
            eventType: "group.update",
            data: {
              groupId: update.id,
              subject: update.subject || null,
              announce: update.announce || null,
              restrict: update.restrict || null,
            },
            timestamp: new Date().toISOString(),
          });
        }
      }

      // 新群组（被拉入群）
      if (events["groups.upsert"]) {
        const groups = events["groups.upsert"];
        logger.info(`[${accountId}] groups.upsert:`, JSON.stringify(groups, null, 2));

        for (const group of groups) {
          await nats.publishMessage("group.event", {
            accountId: accountId,
            accountPhone: account.phoneNumber,
            eventType: "group.upsert",
            data: {
              groupId: group.id,
              subject: group.subject,
              size: group.participants?.length || 0,
              participants: group.participants || [],
            },
            timestamp: new Date().toISOString(),
          });
        }
      }

      // 群聊消息（在 messages.upsert 中判断）
      // ... 已有 messages.upsert 处理中，如果 remoteJid 包含 @g.us，再推送一份到 group.event
    });

    const timeoutDuration = usePairCode ? 60000 : 120000;
    const timeoutId = setTimeout(() => {
      baileysLogger.error(`[${accountId}] 登录超时`);
      sock.account_status = LOGIN_STATUS.FAILED;
      updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.FAILED, "connected");
      if (rejectFunc && typeof rejectFunc === "function") {
        rejectFunc(new Error("登录超时"));
      }
    }, timeoutDuration);

    const result = await loginPromise;
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    logger.error(`[${accountId}] 创建连接失败:`, error);
    return { status: "failed", error: error.message };
  }
}

async function getConnection(identifier, callback = null, proxyOverride = null) {
  const accountService = require("../account");

  // 1. 复用已有连接
  if (connections.has(identifier)) {
    const sock = connections.get(identifier);
    if (sock?.user) {
      return sock;
    }
    connections.delete(identifier);
  }

  // 2. 从 Redis 获取账号
  const account = await accountService.getAccountByPhoneNumberOrId(identifier);
  if (!account) {
    logger.error(`[${identifier}] 账号不存在`);
    return null;
  }

  if (proxyOverride) {
    account.proxy = proxyOverride;
  }

  // 3. 创建新连接
  const result = await createConnection(account, callback);
  if (result?.status === "connected") {
    return result.sock;  // ← 返回 result.sock
  }
  return null;
}

// 统一的推送函数
async function notifyConnection(identifier, sock) {
  try {
    const nats = require("../config/nats");
    const accountPhone = sock.user?.id?.split("@")[0]?.split(":")[0] || identifier;
    await nats.publishMessage("connection", {
      accountId: identifier,
      accountPhone: accountPhone,
      accountStatus: "normal",
      socketStatus: "connected",
      updatedAt: new Date().toISOString(),
    });
    logger.info(`[${identifier}] ✅ 账号在线已推送 (phone: ${accountPhone})`);
  } catch (err) {
    logger.error(`[${identifier}] ❌ 推送失败:`, err);
  }
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
  if (account && connections.has(account.id)) return await closeConnection(account.id);
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
  getConnection, // ← 这里导出了
  closeConnection,
  CloseConnection,
  getAllConnections,
  getConnectionStatus,
  intervalStopIdelConnection,
  sendRestartNotification,
  LOGIN_STATUS,
};
