// src/services/baileys/connect.js
const { default: makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState, Browsers, makeCacheableSignalKeyStore, proto } = require('@whiskeysockets/baileys');
const { conn } = require('../../utils/logger');
const redisStorage = require('../redisStorage');
const { 
  LOGIN_STATUS, groupCache, msgRetryCounterCache 
} = require('./constants');
const {
  getSessionDir, createProxyAgent, createBaileysLogger,
} = require('./utils');
const { 
  createConnectionHandler, updateAccountStatus 
} = require('./connection-handler');
const {
  handleIncomingMessage,
  handleMessageStatusUpdate,
  handleMessageReceiptUpdate,
  handleMessagingHistory,
  handleChatsUpsert,
} = require('./message-handler');

const logger = conn;
const connections = new Map();

async function createConnection(account, onConnected = null, retryCount = 5, usePairCode = false) {
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
    
    // ==========================================
    // 创建 logger 实例，所有地方统一使用
    // ==========================================
    const baileysLogger = createBaileysLogger();
    
    // 添加 trace 方法（如果不存在）
    if (!baileysLogger.trace) {
      baileysLogger.trace = () => {};
    }

    const sock = makeWASocket({
      version,
      auth: { 
        creds: state.creds, 
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger)  // 改用 baileysLogger
      },
      agent: proxyAgent,
      fetchAgent: proxyAgent,
      shouldSyncHistoryMessage: () => false,
      msgRetryCounterCache,
      connectTimeoutMs: 60000,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
      retryRequestDelayMs: 1000,
      generateHighQualityLinkPreview: true,
      browser: Browsers.macOS("Google Chrome"),
      getMessage: async (key) => {
        try {
          const stored = await redisStorage.getMessageById(key.id);
          if (stored?.message) {
            return typeof stored.message === 'string' ? JSON.parse(stored.message) : stored.message;
          }
          return proto.Message.create({ conversation: '' });
        } catch (error) {
          baileysLogger.error(`[${accountId}] getMessage 失败:`, error);  // 改用 baileysLogger
          return proto.Message.create({ conversation: '' });
        }
      }
    });

    sock.account_status = LOGIN_STATUS.CONNECTING;
    sock.lastActiveTime = new Date();

    const ctx = { accountId, resolveFunc, rejectFunc, retryCount, usePairCode, onConnected, saveCreds, connections };
    const connectionHandler = createConnectionHandler(sock, account, ctx);

    sock.ev.process(async (events) => {
      if (events['creds.update']) {
        await saveCreds();
        baileysLogger.debug(`[${accountId}] 凭证已保存`);  // 改用 baileysLogger
      }

      if (events['connection.update']) {
        connectionHandler(events['connection.update']);
      }

      if (events['messaging-history.set']) {
        await handleMessagingHistory(events, accountId, account.phoneNumber);
      }

      if (events['messages.upsert']) {
        const upsert = events['messages.upsert'];
        if (upsert.type === 'notify' || upsert.type === 'append') {
          sock.lastActiveTime = new Date();
          for (const msg of upsert.messages || []) {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (text === 'requestPlaceholder' && !upsert.requestId) {
              await sock.requestPlaceholderResend(msg.key);
              continue;
            }
            if (text === 'onDemandHistSync') {
              await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
              continue;
            }
            await handleIncomingMessage(sock, msg, accountId, account.phoneNumber);
          }
        }
      }

      if (events['messages.update']) {
        await handleMessageStatusUpdate(events['messages.update'], accountId, account.phoneNumber);
      }

      if (events['message-receipt.update']) {
        await handleMessageReceiptUpdate(events['message-receipt.update'], accountId, account.phoneNumber);
      }

      if (events['chats.upsert']) {
        await handleChatsUpsert(events['chats.upsert'], accountId, account.phoneNumber);
      }

      if (events['groups.update']) {
        for (const event of events['groups.update'] || []) {
          const metadata = await sock.groupMetadata(event.id);
          groupCache.set(event.id, metadata);
        }
      }

      if (events['group-participants.update']) {
        for (const event of events['group-participants.update'] || []) {
          const metadata = await sock.groupMetadata(event.id);
          groupCache.set(event.id, metadata);
        }
      }
    });

    const timeoutDuration = usePairCode ? 60000 : 120000;
    const timeoutId = setTimeout(() => {
      baileysLogger.error(`[${accountId}] 登录超时`);  // 改用 baileysLogger
      sock.account_status = LOGIN_STATUS.FAILED;
      updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.FAILED, 'disconnected');
      rejectFunc(new Error('登录超时'));
    }, timeoutDuration);

    const result = await loginPromise;
    clearTimeout(timeoutId);
    return result;

  } catch (error) {
    baileysLogger.error(`[${accountId}] 创建连接失败:`, error);  // 改用 baileysLogger
    return { status: 'failed', error: error.message };
  }
}

async function getConnection(identifier, callback = null) {
  if (connections.has(identifier)) {
    const sock = connections.get(identifier);
    if (sock?.user) return sock;
    connections.delete(identifier);
  }

  const accountService = require('../account');
  const account = await accountService.getAccountByPhoneNumberOrId(identifier);
  if (!account) {
    logger.error(`[${identifier}] 账号不存在`);
    return null;
  }

  if (connections.has(account.id)) return connections.get(account.id);

  const result = await createConnection(account, callback);
  return result?.status === 'connected' ? result.sock : null;
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
  const accountService = require('../account');
  const account = await accountService.getAccountByPhoneNumberOrId(idOrPhone);
  if (account && connections.has(account.id)) return await closeConnection(account.id);
  logger.warn(`[${idOrPhone}] 未找到对应的活动连接`);
  return false;
}

function getConnectionStatus(accountId) {
  return connections.get(accountId)?.account_status || null;
}

function getAllConnections() { return connections; }

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

async function resetAllConnectionStatus() {
  try {
    const accounts = await redisStorage.getAllAccounts();
    let count = 0;
    for (const account of accounts) {
      if (account.id && account.socket_status === 'connected') {
        await redisStorage.updateAccount(account.id, {
          account_status: 'unconnected',
          lastActive: new Date().toISOString()
        });
        count++;
      }
    }
    logger.info(`✅ 已重置 ${count} 个账号的业务状态`);
    return count;
  } catch (error) {
    logger.error('重置连接状态失败:', error);
    return 0;
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
  resetAllConnectionStatus,
  LOGIN_STATUS,
};