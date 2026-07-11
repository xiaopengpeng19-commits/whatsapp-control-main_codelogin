// services/baileys/connect.js
const { default: makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState, DisconnectReason, getContentType, Browsers, makeCacheableSignalKeyStore, proto } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const P = require('pino');
const { NodeCache } = require('@cacheable/node-cache');
const { SocksProxyAgent } = require('socks-proxy-agent');
const snowflake = require('../../utils/snowflake');
const redisStorage = require('../redisStorage');
const nats = require('../../config/nats');

// 创建日志记录器
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

// 消息重试计数器缓存
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

// ========== 未读消息管理 ==========

// 每个账号的未读消息缓存: accountId -> Map(chatId -> [messageKeys])
const unreadMessagesMap = new Map();

/**
 * 获取账号的未读消息缓存
 * @param {string} accountId - 账号ID
 * @returns {Map} - 会话ID -> 消息key数组的映射
 */
function getUnreadCache(accountId) {
  if (!unreadMessagesMap.has(accountId)) {
    unreadMessagesMap.set(accountId, new Map());
  }
  return unreadMessagesMap.get(accountId);
}

/**
 * 添加未读消息到缓存
 * @param {string} accountId - 账号ID
 * @param {string} chatId - 会话ID
 * @param {Object} msgKey - 消息key
 */
function addUnreadMessage(accountId, chatId, msgKey) {
  const cache = getUnreadCache(accountId);
  if (!cache.has(chatId)) {
    cache.set(chatId, []);
  }
  cache.get(chatId).push(msgKey);
  
  // 限制每个会话的未读消息数量，防止内存溢出
  const messages = cache.get(chatId);
  if (messages.length > 1000) {
    messages.splice(0, messages.length - 1000);
  }
  
  logger.debug(`[${accountId}] 添加未读消息: ${chatId}, 总数: ${messages.length}`);
}

/**
 * 获取会话的未读消息数量
 * @param {string} accountId - 账号ID
 * @param {string} chatId - 会话ID
 * @returns {number} - 未读消息数量
 */
function getUnreadCount(accountId, chatId) {
  const cache = getUnreadCache(accountId);
  if (!cache.has(chatId)) return 0;
  return cache.get(chatId).length;
}

/**
 * 标记会话的所有消息为已读（用户发送消息时触发）
 * @param {Object} sock - Socket连接
 * @param {string} accountId - 账号ID
 * @param {string} chatId - 会话ID
 * @param {boolean} force - 是否强制已读（即使没有未读消息）
 * @returns {Promise<number>} - 已读的消息数量
 */
async function markChatAsRead(sock, accountId, chatId, force = false) {
  const cache = getUnreadCache(accountId);
  
  if (!cache.has(chatId)) {
    if (force) {
      // 强制已读：只读最新的一条消息（模拟打开聊天）
      try {
        await sock.readMessages([{ remoteJid: chatId }]);
        logger.debug(`[${accountId}] 强制已读会话: ${chatId}`);
        return 1;
      } catch (error) {
        logger.warn(`[${accountId}] 强制已读失败: ${chatId}`, error.message);
        return 0;
      }
    }
    return 0;
  }
  
  const keys = cache.get(chatId);
  if (keys.length === 0) return 0;
  
  try {
    // 批量已读所有未读消息
    await sock.readMessages(keys);
    const count = keys.length;
    
    // 清空已读的消息
    cache.set(chatId, []);
    
    logger.info(`[${accountId}] 已读会话 ${chatId} 的 ${count} 条消息 (触发: 用户发送消息)`);
    
    // 发布已读事件到 NATS
    await nats.publishMessage('msgs', {
      accountId,
      chatId,
      readCount: count,
      eventType: 'chat_read_on_send',
      timestamp: new Date().toISOString()
    });
    
    return count;
  } catch (error) {
    logger.error(`[${accountId}] 标记已读失败: ${chatId}`, error);
    return 0;
  }
}

/**
 * 清理未读缓存（定时任务）
 */
function cleanupUnreadCache() {
  for (const [accountId, cache] of unreadMessagesMap) {
    let hasData = false;
    for (const [chatId, messages] of cache) {
      if (messages.length > 100) {
        cache.set(chatId, messages.slice(-50));
      }
      if (messages.length > 0) {
        hasData = true;
      }
    }
    if (!hasData) {
      unreadMessagesMap.delete(accountId);
    }
  }
}

// 每小时清理一次
setInterval(cleanupUnreadCache, 60 * 60 * 1000);

// ========== 辅助函数 ==========

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
        logger.info(`[${accountId}] 会话目录非空，保留: ${files.length} 个文件`);
      }
    }
  } catch (error) {
    logger.error(`[${accountId}] 清理会话失败:`, error);
  }
}

// ========== 核心函数：创建连接 ==========

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

    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.debug({ version: version.join('.'), isLatest }, `[${accountId}] 使用最新 WA 版本`);

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

    // 创建 socket
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
      getMessage: async (key) => {
        try {
          const stored = await redisStorage.getMessageById(key.id);
          if (stored && stored.message) {
            if (typeof stored.message === 'string') {
              try {
                return JSON.parse(stored.message);
              } catch {
                return proto.Message.create({ conversation: stored.message });
              }
            }
            return stored.message;
          }
          return proto.Message.create({ conversation: '' });
        } catch (error) {
          logger.error(`[${accountId}] getMessage 失败:`, error);
          return proto.Message.create({ conversation: '' });
        }
      }
    });

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

    // ---------- 统一事件处理 ----------
    sock.ev.process(async (events) => {
      
      // 凭证更新
      if (events['creds.update']) {
        await saveCreds();
        logger.debug(`[${accountId}] 凭证已保存`);
      }

      // 连接更新
      if (events['connection.update']) {
        const update = events['connection.update'];
        const { connection, lastDisconnect, qr } = update;

        logger.debug(`[${accountId}] 连接更新:`, update);

        // 处理配对码登录
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
            
            await updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_PAIR_CODE);
            
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

        // 处理二维码登录
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

        // 处理连接关闭
        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error instanceof Boom) 
            ? lastDisconnect.error?.output?.statusCode 
            : null;
          
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut 
            && statusCode !== 403 
            && lastDisconnect?.error?.message !== 'QR refs attempts ended';

          logger.warn(`[${accountId}] 连接关闭, 状态码: ${statusCode}, 重试: ${shouldReconnect}`);

          if (shouldReconnect && retryCount > 0) {
            logger.info(`[${accountId}] 剩余重试次数: ${retryCount}`);
            const result = await createConnection(account, onConnected, retryCount - 1, usePairCode);
            if (result && resolveFunc) {
              resolveFunc(result);
            }
            return;
          } else {
            const status = statusCode === 403 ? LOGIN_STATUS.BANNED : LOGIN_STATUS.EXPIRED;
            sock.account_status = status;
            await updateAccountStatus(accountId, account.phoneNumber, status);
            
            await cleanupSession(accountId);
            unreadMessagesMap.delete(accountId);
            connections.delete(accountId);
            
            if (rejectFunc) {
              rejectFunc(new Error(`连接失败: ${lastDisconnect?.error?.message || '未知错误'}`));
            }
          }
        }

        // 处理连接成功
        if (connection === 'open') {
          const phoneNumber = sock.user?.id?.split(':')[0];
          account.phoneNumber = phoneNumber;
          sock.account_status = LOGIN_STATUS.CONNECTED;
          sock.lastActiveTime = new Date();

          await updateAccountStatus(accountId, phoneNumber, LOGIN_STATUS.CONNECTED);
          connections.set(accountId, sock);

          logger.info(`[${accountId}] WhatsApp 连接成功: ${phoneNumber}`);

          if (onConnected) {
            try {
              await onConnected(sock);
            } catch (err) {
              logger.error(`[${accountId}] 回调执行失败:`, err);
            }
          }

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

      // 消息历史同步
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

      // 新消息
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert'];
        logger.debug(`[${accountId}] 消息更新: type=${upsert.type}`);

        if (!!upsert.requestId) {
          logger.debug(`[${accountId}] 占位符请求消息接收:`, upsert.requestId);
        }

        if (upsert.type === 'notify' || upsert.type === 'append') {
          sock.lastActiveTime = new Date();
          
          for (const msg of upsert.messages || []) {
            try {
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

              await handleIncomingMessage(sock, msg, accountId, account.phoneNumber);
              
            } catch (error) {
              logger.error(`[${accountId}] 处理消息失败:`, error);
            }
          }
        }
      }

      // 消息状态更新
      if (events['messages.update']) {
        logger.debug(`[${accountId}] 消息状态更新:`, events['messages.update']);
        await handleMessageStatusUpdate(events['messages.update'], accountId, account.phoneNumber);
      }

      // 消息回执
      if (events['message-receipt.update']) {
        logger.debug(`[${accountId}] 消息回执更新:`, events['message-receipt.update']);
        await handleMessageReceiptUpdate(events['message-receipt.update'], accountId, account.phoneNumber);
      }

      // 聊天更新
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

      // 群组更新
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

      // 其他事件日志
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

// ========== 消息处理函数 ==========

/**
 * 处理接收到的消息（不立即已读，只缓存）
 */
async function handleIncomingMessage(sock, msg, accountId, accountPhone) {
  try {
    const messageType = getContentType(msg.message);
    const chatId = msg.key.remoteJid;
    
    // 如果是自己发送的消息，触发该会话的已读
    if (msg.key.fromMe) {
      if (chatId && !isJidNewsletter(chatId)) {
        await markChatAsRead(sock, accountId, chatId);
      }
      return;
    }
    
    // 构建消息数据
    const messageData = {
      accountId,
      accountPhone,
      messageId: msg.key.id,
      remoteJid: chatId,
      remoteJidAlt: msg.key.remoteJidAlt,
      fromMe: false,
      timestamp: msg.messageTimestamp,
      pushName: msg.pushName,
      participant: msg.key.participant,
      messageType: messageType,
      content: extractMessageContent(msg.message),
      rawMessage: msg.message,
      readStatus: 'unread'
    };

    // 发布到 NATS
    await nats.publishMessage('msgs', messageData);
    
    // 保存到 Redis（标记为未读）
    await redisStorage.saveMessage({
      accountId,
      accountPhone,
      messageId: msg.key.id,
      remoteJid: chatId,
      fromMe: false,
      timestamp: msg.messageTimestamp,
      pushName: msg.pushName,
      participant: msg.key.participant,
      content: extractMessageContent(msg.message),
      MessageType: messageType,
      originalMessageType: messageType,
      message: msg.message,
      readStatus: 'unread'
    });

    // 不立即已读，只缓存
    if (chatId && !isJidNewsletter(chatId)) {
      addUnreadMessage(accountId, chatId, msg.key);
      logger.debug(`[${accountId}] 收到消息 ${msg.key.id}, 会话: ${chatId}, 未读数: ${getUnreadCount(accountId, chatId)}`);
    }
    
  } catch (error) {
    logger.error(`[${accountId}] 处理消息失败:`, error);
  }
}

/**
 * 处理消息状态更新
 */
async function handleMessageStatusUpdate(updates, accountId, accountPhone) {
  for (const update of updates || []) {
    try {
      const { key, update: statusUpdate } = update;
      
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
        receiptType: update.type,
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

// ========== 连接管理函数 ==========

/**
 * 获取连接
 * @param {string} identifier - 账号ID或手机号
 * @param {Function} callback - 连接成功回调
 * @returns {Promise<Object>} - Socket 连接对象
 */
async function getConnection(identifier, callback = null) {
  if (connections.has(identifier)) {
    const sock = connections.get(identifier);
    if (sock && sock.user) {
      return sock;
    }
    connections.delete(identifier);
  }

  const accountService = require('../account');
  let account = await accountService.getAccountByPhoneNumberOrId(identifier);

  if (!account) {
    logger.error(`[${identifier}] 账号不存在`);
    return null;
  }

  if (connections.has(account.id)) {
    return connections.get(account.id);
  }

  const result = await createConnection(account, callback);
  if (result && result.status === 'connected') {
    return result.sock;
  }
  
  logger.error(`[${account.id}] 连接创建失败: ${result?.error || '未知错误'}`);
  return null;
}

/**
 * 关闭连接（通过 accountId）
 * @param {string} accountId - 账号ID
 * @returns {Promise<boolean>} - 是否成功
 */
async function closeConnection(accountId) {
  if (connections.has(accountId)) {
    try {
      const sock = connections.get(accountId);
      if (sock && typeof sock.end === 'function') {
        await sock.end();
      }
      connections.delete(accountId);
      unreadMessagesMap.delete(accountId);
      logger.info(`[${accountId}] 连接已关闭，未读缓存已清理`);
      return true;
    } catch (error) {
      logger.error(`[${accountId}] 关闭连接失败:`, error);
      connections.delete(accountId);
      unreadMessagesMap.delete(accountId);
      return false;
    }
  }
  return false;
}

/**
 * 关闭连接（通过 accountId 或 phoneNumber）- 兼容旧接口
 * @param {string} idOrPhone - 账号ID或手机号
 * @returns {Promise<boolean>} - 是否成功
 */
async function CloseConnection(idOrPhone) {
  // 尝试直接通过 ID 查找
  if (connections.has(idOrPhone)) {
    return await closeConnection(idOrPhone);
  }
  
  // 如果没找到，尝试通过 phoneNumber 查找
  const accountService = require('../account');
  const account = await accountService.getAccountByPhoneNumberOrId(idOrPhone);
  if (account && connections.has(account.id)) {
    return await closeConnection(account.id);
  }
  
  logger.warn(`[${idOrPhone}] 未找到对应的活动连接`);
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
 * @returns {Promise<number>} - 关闭的连接数
 */
async function intervalStopIdelConnection() {
  const now = new Date();
  const idleTimeout = 60 * 60 * 1000;
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

// ========== 外部 API ==========

/**
 * 手动标记会话为已读（供外部调用，带连接检查）
 * @param {string} accountId - 账号ID
 * @param {string} chatId - 会话ID
 * @returns {Promise<number>} - 已读消息数量
 */
async function markChatRead(accountId, chatId) {
  const sock = connections.get(accountId);
  if (!sock) {
    throw new Error(`账号 ${accountId} 未连接`);
  }
  return await markChatAsRead(sock, accountId, chatId);
}

/**
 * 获取账号的未读消息统计
 * @param {string} accountId - 账号ID
 * @returns {Object} - 各会话的未读消息数
 */
function getUnreadStats(accountId) {
  const cache = getUnreadCache(accountId);
  const stats = {};
  for (const [chatId, messages] of cache) {
    stats[chatId] = messages.length;
  }
  return stats;
}

/**
 * 获取会话的未读消息列表
 * @param {string} accountId - 账号ID
 * @param {string} chatId - 会话ID
 * @returns {Array} - 未读消息key列表
 */
function getUnreadMessages(accountId, chatId) {
  const cache = getUnreadCache(accountId);
  if (!cache.has(chatId)) return [];
  return cache.get(chatId);
}

// ========== 模块导出 ==========

module.exports = {
  // 连接创建
  createConnection,
  getConnection,
  
  // 连接关闭（两个版本）
  closeConnection,      // 通过 accountId
  CloseConnection,      // 通过 idOrPhone（兼容旧接口）
  
  // 连接管理
  getAllConnections,
  getConnectionStatus,
  intervalStopIdelConnection,
  
  // 常量
  LOGIN_STATUS,
  
  // 未读消息管理
  markChatAsRead,       // 核心函数（需要 sock 参数）
  markChatRead,         // 对外 API（带连接检查）
  getUnreadStats,
  getUnreadMessages,
};