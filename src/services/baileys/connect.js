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
const { getSessionDir, createProxyAgent, createBaileysLogger, releaseSock } = require("./utils");
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
// 连接池
// ==========================================
const ConnectionPool = require("./connection-pool");

const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS) || 150;
const MIN_CONNECTIONS = parseInt(process.env.MIN_CONNECTIONS) || 10;
const IDLE_TIMEOUT_MINUTES = parseInt(process.env.IDLE_TIMEOUT_MINUTES) || 30;

const connectionPool = new ConnectionPool({
  maxSize: MAX_CONNECTIONS,
  minSize: MIN_CONNECTIONS,
  idleTimeout: IDLE_TIMEOUT_MINUTES * 60 * 1000,
});

// ==========================================
// 登录中的号码（防并发创建）
// phoneNumber → true
// ==========================================
const pendingConnections = new Map();

// ==========================================
// 创建连接
// ==========================================
async function createConnection(account, onConnected = null, usePairCode = false) {
  const accountId = account.id;
  let resolveFunc, rejectFunc;
  let sock = null;
  let timeoutId = null;

  const loginPromise = new Promise((resolve, reject) => {
    resolveFunc = resolve;
    rejectFunc = reject;
  });

  try {
    const sessionDir = getSessionDir(accountId);
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const proxyAgent = createProxyAgent(account.proxy);

    logger.info(`[${account.phoneNumber || account.id}] 使用 [${account.proxy}]`);

    const baileysLogger = createBaileysLogger();
    if (!baileysLogger.trace) {
      baileysLogger.trace = () => {};
    }

    const hasSynced = account.phoneNumber ? await getAccountSyncFlag(account.phoneNumber) : false;
    const shouldSync = !hasSynced;

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      reconnect: false,
      maxReconnectAttempts: 0,
      agent: proxyAgent,
      fetchAgent: proxyAgent,
      shouldSyncHistoryMessage: (msg) => {
        // syncType === 2 是 FULL（全量历史），直接拒绝
        // 避免大批量历史消息一次性进内存
        if (msg && msg.syncType === 2) {
          return false;
        }
        return true;
      },
      syncFullHistory: false,
      syncFullHistory: false,
      msgRetryCounterCache,
      connectTimeoutMs: 120000,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
      retryRequestDelayMs: 1000,
      generateHighQualityLinkPreview: true,
      browser: ["Ubuntu", "Chrome", "20.0.04"],
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
      usePairCode,
      onConnected,
      saveCreds,
      connectionPool,
      _resolved: false,
      resolveFunc: (val) => {
        ctx._resolved = true;
        resolveFunc(val);
      },
      rejectFunc: (err) => {
        ctx._resolved = true;
        rejectFunc(err);
      },
    };
    const connectionHandler = createConnectionHandler(sock, account, ctx);

    sock.ev.process(async (events) => {
      const eventKeys = Object.keys(events);
      if (eventKeys.length > 0) {
        logger.info(`[${account.phoneNumber || accountId}] 触发事件: ${JSON.stringify(eventKeys)}`);
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
            const jid = contact.lid;
            const phoneNumber = contact.phoneNumber?.split("@")[0];
            const name = contact.name || contact.notify || phoneNumber;

            await redisStorage.upsertChat({
              id: snowflake.nextId(),
              peerPhone: phoneNumber,
              peerId: jid,
              peerName: name,
              accountId: accountId,
              accountPhone: account.phoneNumber,
              isGroup: phoneNumber?.includes("g.us") || false,
              contactAdded: true,
            });
          } catch (error) {
            logger.error(`[${accountId}] 保存联系人失败:`, error);
          }
        }
      }

      if (events["messaging-history.set"]) {
        if (account.phoneNumber) {
          await setAccountSyncFlag(account.phoneNumber, true);
        }
        await handleMessagingHistory(events, accountId, account.phoneNumber);
      }

      if (events["messages.upsert"]) {
        const upsert = events["messages.upsert"];
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
        await handleChatsUpsert(events["chats.upsert"], accountId, account.phoneNumber);
      }

      if (events["chats.update"]) {
        const updates = events["chats.update"];
        for (const update of updates) {
          const id = update.id;
          if (id && id.includes("@g.us")) continue;

          for (const msgData of update.messages || []) {
            const key = msgData.message?.key;
            const pushName = msgData.message?.pushName;

            if (key) {
              const jid = key.remoteJid;
              const altJid = key.remoteJidAlt;

              if (jid && !jid.includes("@g.us") && !jid.includes("@newsletter")) {
                let peerPhone = "";
                if (altJid && altJid.includes("@s.whatsapp.net")) {
                  peerPhone = altJid.split("@")[0];
                } else {
                  peerPhone = jid.split("@")[0];
                }

                await redisStorage.upsertChat({
                  accountId: accountId,
                  accountPhone: account.phoneNumber,
                  peerPhone: peerPhone,
                  peerId: jid,
                  peerName: pushName || peerPhone,
                  isGroup: false,
                });
              }
            }
          }
        }
      }

      if (events["group-participants.update"]) {
        const update = events["group-participants.update"];
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

    // ========== 超时处理 ==========
    const timeoutDuration = usePairCode ? 60000 : 120000;
    timeoutId = setTimeout(() => {
      if (ctx._resolved) return;
      ctx._resolved = true;

      logger.error(`[${account.phoneNumber || accountId}] 登录超时`);

      try {
        releaseSock(sock, `[${account.phoneNumber || accountId}] 登录超时`).catch(() => {});
        logger.info(`[${account.phoneNumber || accountId}] 超时后已释放 sock`);
      } catch (e) {
        logger.error(`[${account.phoneNumber || accountId}] 释放 sock 失败:`, e);
      }

      const isActuallyOnline = sock?.account_status === LOGIN_STATUS.CONNECTED;
      if (!isActuallyOnline) {
        updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.FAILED, "disconnected");
      } else {
        logger.warn(`[${account.phoneNumber || accountId}] 登录超时，但账号仍在线`);
      }

      if (rejectFunc && typeof rejectFunc === "function") {
        rejectFunc(new Error("登录超时"));
      }
    }, timeoutDuration);

    // ========== 配对码模式 ==========
    if (usePairCode && !state.creds.registered) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const code = await sock.requestPairingCode(account.phoneNumber);
        logger.info(`[${account.phoneNumber}] 配对码生成成功: ${code}`);
        resolveFunc({
          status: "waiting_pair_code",
          code,
          accountId,
          phoneNumber: account.phoneNumber,
        });
      } catch (err) {
        logger.error(`[${account.phoneNumber}] 配对码请求失败:`, err);
        rejectFunc(err);
      }
    }

    const result = await loginPromise;
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);

    logger.error(`[${account.phoneNumber || accountId}] 创建连接失败:`, error);

    try {
      await releaseSock(sock, `[${account.phoneNumber || accountId}] createConnection catch`);
      logger.info(`[${account.phoneNumber || accountId}] 异常后已释放 sock`);
    } catch (e) {
      logger.error(`[${account.phoneNumber || accountId}] 释放 sock 失败:`, e);
    }

    return { status: "failed", error: error.message };
  }
}

// ==========================================
// 获取连接
// ==========================================
async function getConnection(identifier, callback = null, proxyOverride = null, force = false) {
  const accountService = require("../account");

  const account = await accountService.getAccountByPhoneNumberOrId(identifier);
  if (!account) {
    logger.error(`[${identifier}] 账号不存在`);
    return null;
  }

  // ★ 池 key 用号码
  const poolKey = account.phoneNumber ? String(account.phoneNumber) : String(account.id);

  // 1. 池里有 → 直接返回
  if (connectionPool.has(poolKey)) {
    const sock = connectionPool.get(poolKey);
    if (sock?.user) {
      logger.debug(`[${poolKey}] 池中已有连接，复用`);
      return sock;
    }
    // user 为空 → 释放旧 sock
    await connectionPool.releaseAndClose(poolKey, `[getConnection] user empty`);
  }

  if (!force) {
    return null;
  }
  // ★ 并发限制：如果 pending 队列超过 50 个，直接拒绝，防止瞬间创建太多
  if (pendingConnections.size > 50) {
    logger.warn(`[${identifier}] 并发创建连接过多 (${pendingConnections.size})，拒绝创建`);
    return null;
  }
  // ★ 2. 有 pending → 直接返回，不等待，不创建
  if (pendingConnections.has(poolKey)) {
    logger.info(`[${poolKey}] 连接正在进行中，忽略本次请求`);
    return null;
  }

  // 3. 检查账号状态
  if (account.account_status === "expired" || account.account_status === "banned") {
    logger.warn(`[${identifier}] 账号已失效 (${account.account_status})，跳过`);
    return null;
  }

  if (proxyOverride) {
    account.proxy = proxyOverride;
  }

  // 4. 标记「登录中」
  pendingConnections.set(poolKey, true);

  try {
    const conn = await connectionPool.acquire(poolKey, async () => {
      const result = await createConnection(account, callback);
      if (result?.status === "connected") {
        return result.sock;
      }
      throw new Error(result?.error || "连接失败");
    });
    return conn;
  } catch (error) {
    throw error;
  } finally {
    // 5. 连接结束（成功/失败）→ 清除标记
    pendingConnections.delete(poolKey);
  }
}

// ==========================================
// 关闭连接
// ==========================================
async function closeConnection(poolKey) {
  if (connectionPool.has(poolKey)) {
    await connectionPool.releaseAndClose(poolKey, `closeConnection ${poolKey}`);
    return true;
  }
  return false;
}

async function CloseConnection(idOrPhone) {
  try {
    const accountService = require("../account");
    const account = await accountService.getAccountByPhoneNumberOrId(idOrPhone);
    const poolKey = account?.phoneNumber ? String(account.phoneNumber) : String(idOrPhone);

    if (connectionPool.has(poolKey)) {
      return await closeConnection(poolKey);
    }
    logger.info(`[${idOrPhone}] 连接不存在，已是离线状态`);
    return true;
  } catch (error) {
    logger.error(`[${idOrPhone}] 下线失败:`, error);
    return false;
  }
}

// ==========================================
// 连接状态
// ==========================================
function getConnectionStatus(phoneNumber) {
  const entry = connectionPool.connections.get(phoneNumber);
  return entry?.connection?.account_status || null;
}

function getAllConnections() {
  return connectionPool.connections;
}

// ==========================================
// 检查是否登录中（供 Online 使用）
// ==========================================
function isConnecting(identifier) {
  return pendingConnections.has(String(identifier));
}

// ==========================================
// 空闲清理
// ==========================================
async function intervalStopIdelConnection() {
  const idleCount = connectionPool.evictIdle();
  return idleCount;
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
    logger.info("重启通知已发送到 NATS");
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
  isConnecting,
  intervalStopIdelConnection,
  sendRestartNotification,
  LOGIN_STATUS,
  connectionPool,
};
