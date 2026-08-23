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

// ==========================================
// 连接池（单例）
// ==========================================
const ConnectionPool = require("./connection-pool");

// 从环境变量读取配置
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS) || 150;
const MIN_CONNECTIONS = parseInt(process.env.MIN_CONNECTIONS) || 10;
const IDLE_TIMEOUT_MINUTES = parseInt(process.env.IDLE_TIMEOUT_MINUTES) || 30;

const connectionPool = new ConnectionPool({
  maxSize: MAX_CONNECTIONS,
  minSize: MIN_CONNECTIONS,
  idleTimeout: IDLE_TIMEOUT_MINUTES * 60 * 1000,
});

// ==========================================
// 创建连接
// ==========================================
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
      reconnect: false,
      maxReconnectAttempts: 0,
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
      connectionPool, // ✅ 传入 connectionPool
      _resolved: false,
    };
    const connectionHandler = createConnectionHandler(sock, account, ctx);

    sock.ev.process(async (events) => {
      const eventKeys = Object.keys(events);
      if (eventKeys.length > 0) {
        logger.info(`[${accountId}] 触发事件:`, eventKeys);
      }

      if (events["creds.update"]) {
        await saveCreds();
        baileysLogger.debug(`[${accountId}] 凭证已保存`);
      }

      if (events["connection.update"]) {
        connectionHandler(events["connection.update"]);
      }

      if (events["contacts.upsert"]) {
        const contacts = events["contacts.upsert"];
        
        for (const contact of contacts || []) {
          try {
            logger.info(`[${account.phoneNumber}] 联系人更新: phoneNumber = ${contact.phoneNumber} ID = ${contact.id} `);
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

      if (events["messaging-history.set"]) {
        if (account.phoneNumber) {
          await setAccountSyncFlag(account.phoneNumber, true);
          logger.info(`[${accountId}] 历史同步完成，已标记 ${account.phoneNumber}`);
        }
        await handleMessagingHistory(events, accountId, account.phoneNumber);
      }

      if (events["messages.upsert"]) {
        const upsert = events["messages.upsert"];
        logger.info(`[${accountId}] messages.upsert 数据:`, JSON.stringify(upsert, null, 2));
        if (upsert.type === "notify" || upsert.type === "append") {
          sock.lastActiveTime = new Date();
          for (const msg of upsert.messages || []) {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
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

      if (events["messages.update"]) {
        await handleMessageStatusUpdate(events["messages.update"], accountId, account.phoneNumber);
      }

      if (events["message-receipt.update"]) {
        await handleMessageReceiptUpdate(events["message-receipt.update"], accountId, account.phoneNumber);
      }

      if (events["chats.upsert"]) {
        logger.info(`[${accountId}] chats.upsert 数据:`, JSON.stringify(events["chats.upsert"], null, 2));
        await handleChatsUpsert(events["chats.upsert"], accountId, account.phoneNumber);
      }
      if (events["chats.update"]) {
        const updates = events["chats.update"];
        logger.info(`[${accountId}] chats.update 数据:`, JSON.stringify(updates, null, 2));

        // ========== 新增：保存会话 ==========
        for (const update of updates) {
          if (update.id) {
            const jid = update.id;
            // 从 messages 里提取手机号和名字
            let phoneNumber = jid.split("@")[0] || jid;
            let name = phoneNumber;

            // 如果有消息，从消息里提取 pushName 和手机号
            if (update.messages && update.messages.length > 0) {
              const msg = update.messages[0];
              if (msg.message) {
                // 从 remoteJidAlt 获取真实手机号
                const altJid = msg.message.key?.remoteJidAlt;
                if (altJid) {
                  phoneNumber = altJid.split("@")[0] || altJid;
                }
                // 从 pushName 获取名字
                if (msg.message.pushName) {
                  name = msg.message.pushName;
                }
              }
            }

            await redisStorage.upsertChat({
              id: snowflake.nextId(),
              peerPhone: phoneNumber,
              peerId: jid,
              peerName: name,
              accountId: accountId,
              accountPhone: account.phoneNumber,
              isGroup: jid.includes("g.us") || false,
              contactAdded: true,
            });
            logger.info(`[${accountId}] ✅ 从 chats.update 保存会话: ${phoneNumber} (${name})`);
          }
        }
      }

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

// ==========================================
// 获取连接
// ==========================================
async function getConnection(identifier, callback = null, proxyOverride = null) {
  const accountService = require("../account");

  // 1. 检查连接池
  if (connectionPool.has(identifier)) {
    const sock = connectionPool.get(identifier);
    if (sock?.user) {
      return sock;
    }
    connectionPool.release(identifier);
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

  // 3. 使用连接池获取连接
  return connectionPool.acquire(account.id, async () => {
    const result = await createConnection(account, callback);
    if (result?.status === "connected") {
      return result.sock;
    }
    throw new Error(result?.error || "连接失败");
  });
}

// ==========================================
// 通知推送
// ==========================================
async function notifyConnection(identifier, sock) {
  console.log(`📡 [notifyConnection] 开始推送: ${identifier}`);
  try {
    const nats = require("../../config/nats");
    const accountPhone = sock.user?.id?.split("@")[0]?.split(":")[0] || identifier;
    console.log(`📡 [notifyConnection] 准备推送: accountId=${identifier}, phone=${accountPhone}`);
    await nats.publishMessage("connection", {
      accountId: identifier,
      accountPhone: accountPhone,
      accountStatus: "normal",
      socketStatus: "connected",
      updatedAt: new Date().toISOString(),
    });
    logger.info(`[${identifier}] ✅ 账号在线已推送 (phone: ${accountPhone})`);
    console.log(`✅ [notifyConnection] 推送成功: ${accountPhone}`);
  } catch (err) {
    console.log(`❌ [notifyConnection] 推送失败: ${identifier}`, err);
    logger.error(`[${identifier}] ❌ 推送失败:`, err);
  }
}

// ==========================================
// 关闭连接
// ==========================================
async function closeConnection(accountId) {
  if (connectionPool.has(accountId)) {
    const sock = connectionPool.get(accountId);
    if (sock) {
      sock._manualClose = true;
      await sock.end();
    }
    connectionPool.release(accountId);
    logger.info(`[${accountId}] 连接已关闭`);
    return true;
  }
  return false;
}

async function CloseConnection(idOrPhone) {
  if (connectionPool.has(idOrPhone)) {
    return await closeConnection(idOrPhone);
  }
  const accountService = require("../account");
  const account = await accountService.getAccountByPhoneNumberOrId(idOrPhone);
  if (account && connectionPool.has(account.id)) {
    return await closeConnection(account.id);
  }
  logger.warn(`[${idOrPhone}] 未找到对应的活动连接`);
  return false;
}

// ==========================================
// 获取连接状态
// ==========================================
function getConnectionStatus(accountId) {
  const entry = connectionPool.connections.get(accountId);
  return entry?.connection?.account_status || null;
}

function getAllConnections() {
  return connectionPool.connections;
}

// ==========================================
// 空闲清理
// ==========================================
async function intervalStopIdelConnection() {
  const evicted = connectionPool.evictIdle();
  if (evicted > 0) {
    logger.info(`清理 ${evicted} 个空闲连接`);
  }
  return evicted;
}

// ==========================================
// 重启通知
// ==========================================
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

// ==========================================
// 导出
// ==========================================
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
  connectionPool,
};
