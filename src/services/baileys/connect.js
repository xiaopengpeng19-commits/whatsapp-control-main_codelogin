// src/services/baileys/connect.js

const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
  makeCacheableSignalKeyStore,
  proto,
} = require("@whiskeysockets/baileys");

const net = require("net");
const { NodeCache } = require("@cacheable/node-cache"); // ★ 修复：引入 NodeCache
const { LRUCache } = require("lru-cache"); // ★ 修复：引入 LRU 缓存限制密钥库

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
// ==========================================
const pendingConnections = new Map();

// ==========================================
// 失败冷却记录表
// ==========================================
const failureCooldown = new Map();
const COOLDOWN_MS = 30 * 1000; // 失败后冷却 30 秒

// 检测代理是否连通
function checkProxyAlive(proxyStr, timeout = 2000) {
  return new Promise((resolve) => {
    try {
      if (!proxyStr || typeof proxyStr !== "string") return resolve(true);

      let host, port;
      if (proxyStr.includes("://")) {
        const url = new URL(proxyStr);
        host = url.hostname;
        port = url.port || 1080;
      } else {
        const parts = proxyStr.split(":");
        host = parts[0];
        port = parts[1] || 1080;
      }
      if (!host || !port) return resolve(false);

      const socket = new net.Socket();
      socket.setTimeout(timeout);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    } catch (e) {
      resolve(false);
    }
  });
}

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

    // ★ 终极防漏：用 LRU 限制密钥库，最多 1 万条，存活 24 小时，绝不撑爆内存
    const lruKeys = new LRUCache({ max: 10000, ttl: 1000 * 60 * 60 * 24 });
    const originalKeys = state.keys;
    const wrappedKeys = {
      get: async (type, ids) => {
        const data = {};
        await Promise.all(
          ids.map(async (id) => {
            const key = `${type}-${id}`;
            let value = lruKeys.get(key);
            if (value === undefined) {
              const originalData = await originalKeys.get(type, [id]);
              if (originalData[id]) {
                value = originalData[id];
                lruKeys.set(key, value);
              }
            }
            if (value) data[id] = value;
          }),
        );
        return data;
      },
      set: async (data) => {
        await originalKeys.set(data);
        for (const type in data) {
          for (const id in data[type]) {
            lruKeys.set(`${type}-${id}`, data[type][id]);
          }
        }
      },
    };

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: wrappedKeys, // ★ 使用限制后的 keys
      },
      reconnect: false,
      maxReconnectAttempts: 0,
      agent: proxyAgent,
      fetchAgent: proxyAgent,
      shouldSyncHistoryMessage: (msg) => {
        if (msg && msg.syncType === 2) return false; // 拒绝全量历史
        return true;
      },
      defaultQueryTimeoutMs: 60000,
      syncFullHistory: false,
      msgRetryCounterCache: new NodeCache({ stdTTL: 60 * 10, maxKeys: 5000 }), // ★ 限制最大 5000 条
      connectTimeoutMs: 120000,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
      retryRequestDelayMs: 1000,
      generateHighQualityLinkPreview: false,
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

  const poolKey = account.phoneNumber ? String(account.phoneNumber) : String(account.id);

  // 1. 池里有 → 直接返回
  if (connectionPool.has(poolKey)) {
    const sock = connectionPool.get(poolKey);
    if (sock?.user) {
      failureCooldown.delete(poolKey);
      return sock;
    }
    await connectionPool.releaseAndClose(poolKey, `[getConnection] user empty`);
  }

  if (!force) {
    return null;
  }

  // 2. 检查是否在失败冷却期
  const blockedUntil = failureCooldown.get(poolKey);
  if (blockedUntil && Date.now() < blockedUntil) {
    const remain = Math.ceil((blockedUntil - Date.now()) / 1000);
    logger.warn(`[${poolKey}] 失败冷却中，剩余 ${remain}s，拒绝本次请求`);
    return null;
  }

  // 3. 检查并发限制
  const MAX_CONCURRENT_CONNECTIONS = 5;
  if (pendingConnections.size >= MAX_CONCURRENT_CONNECTIONS) {
    logger.warn(`[${poolKey}] 并发连接已达上限 ${MAX_CONCURRENT_CONNECTIONS}，忽略本次请求`);
    return null;
  }

  // 4. 检查是否正在连接中
  if (pendingConnections.has(poolKey)) {
    logger.info(`[${poolKey}] 连接正在进行中，忽略本次请求`);
    return null;
  }

  // 5. 检查账号状态
  if (account.account_status === "expired" || account.account_status === "banned") {
    logger.warn(`[${identifier}] 账号已失效 (${account.account_status})，跳过`);
    return null;
  }

  if (proxyOverride) {
    account.proxy = proxyOverride;
  }

  // 6. 前置代理探活检测
  if (account.proxy) {
    try {
      const isProxyAlive = await checkProxyAlive(account.proxy);
      if (!isProxyAlive) {
        logger.warn(`[${poolKey}] 代理不通，拒绝建立连接: ${account.proxy}`);
        failureCooldown.set(poolKey, Date.now() + COOLDOWN_MS);
        return null;
      }
    } catch (e) {
      logger.error(`[${poolKey}] 代理检测异常:`, e);
      failureCooldown.set(poolKey, Date.now() + COOLDOWN_MS);
      return null;
    }
  }

  // 7. 开始建立连接
  pendingConnections.set(poolKey, true);

  try {
    const conn = await connectionPool.acquire(poolKey, async () => {
      const result = await createConnection(account, callback);
      if (result?.status === "connected") {
        failureCooldown.delete(poolKey);
        return result.sock;
      }
      failureCooldown.set(poolKey, Date.now() + COOLDOWN_MS);
      throw new Error(result?.error || "连接失败");
    });
    return conn;
  } catch (error) {
    failureCooldown.set(poolKey, Date.now() + COOLDOWN_MS);
    throw error;
  } finally {
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

function isConnecting(identifier) {
  return pendingConnections.has(String(identifier));
}

async function intervalStopIdelConnection() {
  const idleCount = connectionPool.evictIdle();
  return idleCount;
}

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
