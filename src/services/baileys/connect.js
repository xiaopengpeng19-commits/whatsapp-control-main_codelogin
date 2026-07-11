// services/baileys/connect.js
const { default: makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState, DisconnectReason, getContentType, Browsers, makeCacheableSignalKeyStore, generateMessageIDV2, proto } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const P = require('pino');
const { NodeCache } = require('@cacheable/node-cache');
const { SocksProxyAgent } = require('socks-proxy-agent');
const snowflake = require('../../utils/snowflake');
const redisStorage = require('../redisStorage');
const nats = require('../../config/nats');

// 创建日志记录器 - 参考官方示例
const logger = P({
  level: process.env.LOG_LEVEL || 'trace',
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: { colorize: true },
        level: 'trace',
      },
      {
        target: 'pino/file',
        options: { destination: './wa-logs.txt' },
        level: 'trace',
      },
    ],
  },
});

// Map to store active WhatsApp connections
const connections = new Map();
const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });

// 消息重试计数器缓存 - 参考官方示例
const msgRetryCounterCache = new NodeCache();

// 登录状态常量
const LOGIN_STATUS = {
  WAITING_QR: 'waiting_qr',
  WAITING_PAIR_CODE: 'waiting_pair',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  FAILED: 'failed',
  EXPIRED: 'expired',
  BANNED: 'banned'
};

/**
 * 创建 WhatsApp 连接
 * @param {Object} account - 账号信息
 * @param {Function} onConnected - 连接成功回调
 * @param {number} retryCount - 重试次数
 * @param {boolean} usePairCode - 是否使用配对码登录
 * @returns {Promise<Object>} - 连接结果
 */
async function createConnection(account, onConnected = null, retryCount = 5, usePairCode = false) {
  const accountId = account.id;
  let resolveFunc = null;
  let rejectFunc = null;
  
  // 创建登录 Promise
  const loginPromise = new Promise((resolve, reject) => {
    resolveFunc = resolve;
    rejectFunc = reject;
  });

  try {
    let timeoutId = null;
    let sessionDir = null;
    
    try {
      sessionDir = path.join('./storage/sessions', account.id + '');
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
    } catch (error) {
      logger.error(`[${accountId}] 创建会话目录失败:`, error);
    }

    // 获取最新版本 - 参考官方示例
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.debug({ version: version.join('.'), isLatest }, `[${accountId}] 使用最新 WA 版本`);

    // 加载认证状态
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    // 代理配置
    let proxyAgent = null;
    if (account.proxy) {
      try {
        proxyAgent = new SocksProxyAgent(account.proxy);
        logger.info(`[${accountId}] 使用代理: ${account.proxy}`);
      } catch (error) {
        logger.error(`[${accountId}] 代理配置失败:`, error);
      }
    }

    // 创建 socket - 参考官方示例配置
    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      agent: proxyAgent,
      msgRetryCounterCache,
      connectTimeoutMs: 60000,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
      retryRequestDelayMs: 1000,
      generateHighQualityLinkPreview: true,
      browser: Browsers.macOS("Google Chrome"),
      // getMessage 实现 - 用于消息重试和占位符重新发送
      getMessage: async (key) => {
        try {
          // 从 Redis 获取消息
          const stored = await redisStorage.getMessageById(key.id);
          if (stored && stored.message) {
            // 如果是字符串，尝试解析为对象
            if (typeof stored.message === 'string') {
              try {
                return JSON.parse(stored.message);
              } catch {
                return proto.Message.create({ conversation: stored.message });
              }
            }
            return stored.message;
          }
          // 如果找不到，返回一个空消息
          return proto.Message.create({ conversation: '' });
        } catch (error) {
          logger.error(`[${accountId}] getMessage 失败:`, error);
          return proto.Message.create({ conversation: '' });
        }
      }
    });

    // 设置初始状态
    sock.account_status = LOGIN_STATUS.CONNECTING;
    sock.lastActiveTime = new Date();

    // 超时处理
    const timeoutDuration = usePairCode ? 60000 : 120000;
    timeoutId = setTimeout(() => {
      logger.error(`[${accountId}] 登录超时 (${timeoutDuration/1000}秒)`);
      sock.account_status = LOGIN_STATUS.FAILED;
      updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.FAILED);
      if (rejectFunc) {
        rejectFunc(new Error('登录超时'));
      }
    }, timeoutDuration);

    // ---------- 使用 process 方法统一处理所有事件 (参考官方示例) ----------
    sock.ev.process(async (events) => {
      
      // 处理凭证更新
      if (events['creds.update']) {
        await saveCreds();
        logger.debug(`[${accountId}] 凭证已保存`);
      }

      // 处理连接更新
      if (events['connection.update']) {
        const update = events['connection.update'];
        const { connection, lastDisconnect, qr } = update;

        logger.debug(`[${accountId}] 连接更新:`, update);

        // --- 处理配对码登录 (参考官方示例逻辑) ---
        if (qr && usePairCode && !sock.authState.creds.registered) {
          const phoneNumber = account.phoneNumber;
          if (!phoneNumber) {
            logger.error(`[${accountId}] 配对码登录失败: 缺少手机号`);
            rejectFunc(new Error('配对码登录需要提供手机号'));
            return;
          }

          try {
            logger.info(`[${accountId}] 请求配对码，手机号: ${phoneNumber}`);
            const code = await sock.requestPairingCode(phoneNumber);
            logger.info(`[${accountId}] 配对码生成成功: ${code}`);
            
            // 更新账号状态
            await updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_PAIR_CODE);
            
            // 返回配对码
            if (resolveFunc) {
              resolveFunc({
                status: 'waiting_pair_code',
                code: code,
                accountId: accountId,
                phoneNumber: account.phoneNumber
              });
            }
          } catch (err) {
            logger.error(`[${accountId}] 请求配对码失败:`, err);
            sock.account_status = LOGIN_STATUS.FAILED;
            updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.FAILED);
            rejectFunc(err);
          }
          return;
        }

        // --- 处理二维码登录 ---
        if (qr && !usePairCode) {
          logger.info(`[${accountId}] QR码已生成`);
          await updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_QR);
          
          if (resolveFunc) {
            resolveFunc({
              status: 'waiting_qr',
              qr: qr,
              accountId: accountId
            });
          }
        }

        // --- 处理连接关闭 (参考官方示例重连逻辑) ---
        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error instanceof Boom) 
            ? lastDisconnect.error?.output?.statusCode 
            : null;
          
          // 如果不是登出状态，尝试重连
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut 
            && statusCode !== 403 
            && lastDisconnect?.error?.message !== 'QR refs attempts ended';

          logger.warn(`[${accountId}] 连接关闭, 状态码: ${statusCode}, 重试: ${shouldReconnect}`);

          if (shouldReconnect && retryCount > 0) {
            logger.info(`[${accountId}] 剩余重试次数: ${retryCount}`);
            // 递归重试
            const result = await createConnection(account, onConnected, retryCount - 1, usePairCode);
            if (result && resolveFunc) {
              resolveFunc(result);
            }
            return;
          } else {
            // 连接失败，设置状态
            const status = statusCode === 403 ? LOGIN_STATUS.BANNED : LOGIN_STATUS.EXPIRED;
            sock.account_status = status;
            await updateAccountStatus(accountId, account.phoneNumber, status);
            
            // 清理会话
            await cleanupSession(accountId);
            connections.delete(accountId);
            
            if (rejectFunc) {
              rejectFunc(new Error(`连接失败: ${lastDisconnect?.error?.message || '未知错误'}`));
            }
          }
        }

        // --- 处理连接成功 ---
        if (connection === 'open') {
          const phoneNumber = sock.user?.id?.split(':')[0];
          account.phoneNumber = phoneNumber;
          sock.account_status = LOGIN_STATUS.CONNECTED;
          sock.lastActiveTime = new Date();

          // 更新账号信息
          await updateAccountStatus(accountId, phoneNumber, LOGIN_STATUS.CONNECTED);
          
          // 存储连接
          connections.set(accountId, sock);

          logger.info(`[${accountId}] WhatsApp 连接成功: ${phoneNumber}`);

          // 执行回调
          if (onConnected) {
            try {
              await onConnected(sock);
            } catch (err) {
              logger.error(`[${accountId}] 回调执行失败:`, err);
            }
          }

          // 通知登录成功
          if (resolveFunc) {
            resolveFunc({
              status: 'connected',
              sock: sock,
              accountId: accountId,
              phoneNumber: phoneNumber
            });
          }
        }
      }

      // ---------- 处理消息历史同步 (参考官方示例) ----------
      if (events['messaging-history.set']) {
        const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set'];
        logger.debug({
          contacts: contacts?.length || 0, 
          chats: chats?.length || 0, 
          messages: messages?.length || 0, 
          isLatest, 
          progress,
          syncType: syncType?.toString()
        }, `[${accountId}] 消息历史同步`);

        try {
          // 保存聊天
          for (const chat of chats || []) {
            await redisStorage.upsertChat({
              id: snowflake.nextId(),
              peerPhone: chat.id?.split('@')[0] || chat.id,
              peerId: chat.id,
              peerName: chat.name || '',
              accountPhone: account.phoneNumber,
              accountId: accountId,
              isGroup: chat.id?.includes('g.us') || false,
              lastMessageTime: chat.lastMessageRecvTimestamp,
            });
          }

          // 保存联系人
          for (const contact of contacts || []) {
            await redisStorage.upsertChat({
              id: snowflake.nextId(),
              peerPhone: contact.id?.split('@')[0] || contact.id,
              peerId: contact.id,
              peerName: contact.name || contact.notify || '',
              accountId: accountId,
              accountPhone: account.phoneNumber,
              isGroup: contact.id?.includes('g.us') || false,
            });
          }
        } catch (error) {
          logger.error(`[${accountId}] 保存消息历史失败:`, error);
        }
      }

      // ---------- 处理新消息 (参考官方示例) ----------
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert'];
        logger.debug(`[${accountId}] 消息更新: type=${upsert.type}`);

        // 处理占位符重发请求
        if (!!upsert.requestId) {
          logger.debug(`[${accountId}] 占位符请求消息接收:`, upsert.requestId);
        }

        if (upsert.type === 'notify' || upsert.type === 'append') {
          sock.lastActiveTime = new Date();
          
          for (const msg of upsert.messages || []) {
            try {
              // 处理特殊命令 (参考官方示例)
              const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
              
              if (text === 'requestPlaceholder' && !upsert.requestId) {
                const messageId = await sock.requestPlaceholderResend(msg.key);
                logger.debug(`[${accountId}] 请求占位符重发, id=${messageId}`);
                continue;
              }

              if (text === 'onDemandHistSync') {
                const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
                logger.debug(`[${accountId}] 请求按需历史同步, id=${messageId}`);
                continue;
              }

              // 正常消息处理
              await handleIncomingMessage(sock, msg, accountId, account.phoneNumber);
              
            } catch (error) {
              logger.error(`[${accountId}] 处理消息失败:`, error);
            }
          }
        }
      }

      // ---------- 处理消息状态更新 ----------
      if (events['messages.update']) {
        logger.debug(`[${accountId}] 消息状态更新:`, events['messages.update']);
        await handleMessageStatusUpdate(events['messages.update'], accountId, account.phoneNumber);
      }

      // ---------- 处理消息回执 ----------
      if (events['message-receipt.update']) {
        logger.debug(`[${accountId}] 消息回执更新:`, events['message-receipt.update']);
        await handleMessageReceiptUpdate(events['message-receipt.update'], accountId, account.phoneNumber);
      }

      // ---------- 处理聊天更新 ----------
      if (events['chats.upsert']) {
        const chats = events['chats.upsert'];
        logger.debug(`[${accountId}] 聊天更新: ${chats?.length || 0} 个`);
        
        for (const chat of chats || []) {
          try {
            await redisStorage.upsertChat({
              id: snowflake.nextId(),
              peerPhone: chat.id?.split('@')[0] || chat.id,
              peerId: chat.id,
              peerName: chat.name || '',
              accountPhone: account.phoneNumber,
              accountId: accountId,
              isGroup: chat.id?.includes('g.us') || false,
              lastMessageTime: chat.lastMessageRecvTimestamp,
            });
          } catch (error) {
            logger.error(`[${accountId}] 保存聊天失败:`, error);
          }
        }
      }

      // ---------- 处理群组更新 ----------
      if (events['groups.update']) {
        for (const event of events['groups.update'] || []) {
          try {
            const metadata = await sock.groupMetadata(event.id);
            groupCache.set(event.id, metadata);
          } catch (error) {
            logger.error(`[${accountId}] 更新群组缓存失败:`, error);
          }
        }
      }

      if (events['group-participants.update']) {
        for (const event of events['group-participants.update'] || []) {
          try {
            const metadata = await sock.groupMetadata(event.id);
            groupCache.set(event.id, metadata);
          } catch (error) {
            logger.error(`[${accountId}] 更新群成员缓存失败:`, error);
          }
        }
      }

      // ---------- 其他事件日志 ----------
      if (events['labels.association']) {
        logger.debug(`[${accountId}] 标签关联事件`);
      }

      if (events['labels.edit']) {
        logger.debug(`[${accountId}] 标签编辑事件`);
      }

      if (events['call']) {
        logger.debug(`[${accountId}] 通话事件`);
      }

      if (events['contacts.update']) {
        logger.debug(`[${accountId}] 联系人更新事件`);
      }

      if (events['chats.delete']) {
        logger.debug(`[${accountId}] 聊天删除事件`);
      }

      if (events['presence.update']) {
        logger.debug(`[${accountId}] 在线状态更新`);
      }

      if (events['messages.reaction']) {
        logger.debug(`[${accountId}] 消息反应事件`);
      }
    });

    // 等待登录完成
    const result = await loginPromise;
    clearTimeout(timeoutId);
    return result;

  } catch (error) {
    logger.error(`[${accountId}] 创建连接失败:`, error);
    return {
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * 更新账号状态到 Redis
 */
async function updateAccountStatus(accountId, phoneNumber, status) {
  try {
    const accountData = {
      id: accountId,
      phoneNumber: phoneNumber || null,
      socket_status: status,
      account_status: status === LOGIN_STATUS.CONNECTED ? 'normal' : status,
      lastActive: new Date().toISOString()
    };
    
    // 只更新存在性，不覆盖已有字段
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

/**
 * 清理会话文件
 */
async function cleanupSession(accountId) {
  try {
    const sessionDir = `./storage/sessions/${accountId}`;
    if (fs.existsSync(sessionDir)) {
      const files = fs.readdirSync(sessionDir);
      if (files.length === 0) {
        fs.rmdirSync(sessionDir);
        logger.info(`[${accountId}] 清理空会话目录`);
      } else {
        // 如果文件存在但连接失败，可以保留用于调试
        logger.info(`[${accountId}] 会话目录非空，保留: ${files.length} 个文件`);
      }
    }
  } catch (error) {
    logger.error(`[${accountId}] 清理会话失败:`, error);
  }
}

/**
 * 处理接收到的消息
 */
async function handleIncomingMessage(sock, msg, accountId, accountPhone) {
  try {
    const messageType = getContentType(msg.message);
    
    // 构建消息数据
    const messageData = {
      accountId,
      accountPhone,
      messageId: msg.key.id,
      remoteJid: msg.key.remoteJid,
      remoteJidAlt: msg.key.remoteJidAlt,
      fromMe: msg.key.fromMe || false,
      timestamp: msg.messageTimestamp,
      pushName: msg.pushName,
      participant: msg.key.participant,
      messageType: messageType,
      content: extractMessageContent(msg.message),
      rawMessage: msg.message
    };

    // 发布到 NATS
    await nats.publishMessage('msgs', messageData);
    
    // 保存到 Redis
    await redisStorage.saveMessage({
      accountId,
      accountPhone,
      messageId: msg.key.id,
      remoteJid: msg.key.remoteJid,
      fromMe: msg.key.fromMe || false,
      timestamp: msg.messageTimestamp,
      pushName: msg.pushName,
      participant: msg.key.participant,
      content: extractMessageContent(msg.message),
      MessageType: messageType,
      originalMessageType: messageType,
      message: msg.message
    });

    // 标记为已读（非自己发送的消息，且非广播/通知类）
    if (!msg.key.fromMe && msg.key.remoteJid && !isJidNewsletter(msg.key.remoteJid)) {
      await sock.readMessages([msg.key]);
    }
    
    logger.debug(`[${accountId}] 消息处理完成: ${msg.key.id}`);
    
  } catch (error) {
    logger.error(`[${accountId}] 处理消息失败:`, error);
  }
}

/**
 * 判断是否为 Newsletter JID
 */
function isJidNewsletter(jid) {
  return jid && jid.includes('@newsletter');
}

/**
 * 提取消息内容
 */
function extractMessageContent(message) {
  if (!message) return '';
  const type = getContentType(message);
  const msg = message[type];
  if (!msg) return '';
  
  if (msg.caption) return msg.caption;
  if (msg.text) return msg.text;
  if (msg.conversation) return msg.conversation;
  if (msg.displayName) return msg.displayName;
  if (msg.name) return msg.name;
  if (msg.title) return msg.title;
  
  return JSON.stringify(msg);
}

/**
 * 处理消息状态更新
 */
async function handleMessageStatusUpdate(updates, accountId, accountPhone) {
  for (const update of updates || []) {
    try {
      const { key, update: statusUpdate } = update;
      
      // 只关注状态: 3(已送达), 4(已读)
      if (statusUpdate.status !== 3 && statusUpdate.status !== 4) {
        continue;
      }
      
      const statusMap = { 3: 'delivery_ack', 4: 'read' };
      const receiptData = {
        accountId,
        accountPhone,
        messageId: key.id,
        remoteJid: key.remoteJid,
        fromMe: key.fromMe || false,
        receipt: statusMap[statusUpdate.status] || `unknown(${statusUpdate.status})`,
        receiptTimestamp: statusUpdate.messageTimestamp || Math.floor(Date.now() / 1000),
        participant: key.participant || null,
        MessageType: 'msg_status_update',
        statusCode: statusUpdate.status
      };

      await nats.publishMessage('msgs', receiptData);
      
      // 更新 Redis 中的消息状态
      await redisStorage.updateMessageStatus(key.id, receiptData.receipt);
      
      logger.debug(`[${accountId}] 消息状态更新: ${key.id} -> ${receiptData.receipt}`);
      
    } catch (error) {
      logger.error(`[${accountId}] 处理消息状态更新失败:`, error);
    }
  }
}

/**
 * 处理消息回执更新
 */
async function handleMessageReceiptUpdate(updates, accountId, accountPhone) {
  for (const update of updates || []) {
    try {
      const receiptData = {
        accountId,
        accountPhone,
        remoteJid: update.remoteJid,
        fromMe: update.fromMe || false,
        receiptType: update.type, // read, delivered, etc.
        receiptTimestamp: update.timestamp || Math.floor(Date.now() / 1000),
        participant: update.participant || null,
        MessageType: 'msg_receipt_update'
      };

      await nats.publishMessage('msgs', receiptData);
      logger.debug(`[${accountId}] 回执更新: ${update.type} for ${update.remoteJid}`);
      
    } catch (error) {
      logger.error(`[${accountId}] 处理回执更新失败:`, error);
    }
  }
}

/**
 * 获取连接
 * @param {string} identifier - 账号ID或手机号
 * @param {Function} callback - 连接成功回调
 * @returns {Promise<Object>} - Socket 连接对象
 */
async function getConnection(identifier, callback = null) {
  // 检查是否已有连接
  if (connections.has(identifier)) {
    const sock = connections.get(identifier);
    // 检查连接是否仍然有效
    if (sock && sock.user) {
      return sock;
    }
    // 连接无效，删除并重新创建
    connections.delete(identifier);
  }

  // 获取账号信息
  const accountService = require('../account');
  let account = await accountService.getAccountByPhoneNumberOrId(identifier);

  if (!account) {
    logger.error(`[${identifier}] 账号不存在`);
    return null;
  }

  // 如果已有该账号的连接，直接返回
  if (connections.has(account.id)) {
    return connections.get(account.id);
  }

  // 创建新连接
  const result = await createConnection(account, callback);
  if (result && result.status === 'connected') {
    return result.sock;
  }
  
  logger.error(`[${account.id}] 连接创建失败: ${result?.error || '未知错误'}`);
  return null;
}

/**
 * 关闭连接
 * @param {string} accountId - 账号ID
 */
async function closeConnection(accountId) {
  if (connections.has(accountId)) {
    try {
      const sock = connections.get(accountId);
      if (sock && typeof sock.end === 'function') {
        await sock.end();
      }
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

/**
 * 获取连接状态
 * @param {string} accountId - 账号ID
 * @returns {string|null} - 连接状态
 */
function getConnectionStatus(accountId) {
  const sock = connections.get(accountId);
  if (!sock) return null;
  return sock.account_status || 'unknown';
}

/**
 * 获取所有连接
 * @returns {Map} - 所有连接
 */
function getAllConnections() {
  return connections;
}

/**
 * 清理空闲连接（定时任务调用）
 */
async function intervalStopIdelConnection() {
  const now = new Date();
  const idleTimeout = 60 * 60 * 1000; // 1小时
  const oneHourAgo = new Date(now.getTime() - idleTimeout);

  let closedCount = 0;
  for (const [accountId, sock] of connections.entries()) {
    if (sock.lastActiveTime && sock.lastActiveTime < oneHourAgo) {
      logger.info(`[${accountId}] 关闭空闲连接，最后活动时间: ${sock.lastActiveTime.toISOString()}`);
      await closeConnection(accountId);
      closedCount++;
    }
  }
  
  if (closedCount > 0) {
    logger.info(`已关闭 ${closedCount} 个空闲连接`);
  }
  
  return closedCount;
}

module.exports = {
  createConnection,
  getConnection,
  closeConnection,
  getAllConnections,
  getConnectionStatus,
  intervalStopIdelConnection,
  LOGIN_STATUS
};