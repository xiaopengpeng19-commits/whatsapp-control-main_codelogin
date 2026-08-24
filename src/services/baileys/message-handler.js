// src/services/baileys/message-handler.js
const { getContentType } = require("@whiskeysockets/baileys");
const snowflake = require("../../utils/snowflake");
const redisStorage = require("../redisStorage");
const nats = require("../../config/nats");
const { isJidNewsletter, extractMessageContent } = require("./utils");
const { conn } = require("../../utils/logger");
const logger = conn;

const pendingReads = new Map();

async function handleIncomingMessage(sock, msg, accountId, accountPhone) {
  try {
    const messageType = getContentType(msg.message);
    const chatId = msg.key.remoteJid;

    if (msg.key.fromMe) return;

    const content = extractMessageContent(msg.message);

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
      messageType,
      content,
      rawMessage: msg.message,
      readStatus: "unread",
    };

    await nats.publishMessage("msgs", messageData);
    await redisStorage.saveMessage({
      accountId,
      accountPhone,
      messageId: msg.key.id,
      remoteJid: chatId,
      fromMe: false,
      timestamp: msg.messageTimestamp,
      pushName: msg.pushName,
      participant: msg.key.participant,
      content,
      MessageType: messageType,
      originalMessageType: messageType,
      message: msg.message,
      readStatus: "unread",
    });

    if (chatId && !isJidNewsletter(chatId)) {
      if (!pendingReads.has(chatId)) {
        pendingReads.set(chatId, { keys: [], timer: null });
      }
      const queue = pendingReads.get(chatId);
      queue.keys.push(msg.key);
      if (queue.timer) clearTimeout(queue.timer);

      const delay = 3000 + Math.random() * 4000;
      queue.timer = setTimeout(async () => {
        const keys = queue.keys || [];
        if (keys.length > 0) {
          try {
            await sock.readMessages(keys);
            logger.info(`[${accountId}] 批量已读 ${keys.length} 条消息, 会话: ${chatId}`);
            for (const key of keys) {
              await redisStorage.updateMessageStatus(key.id, "read");
            }
          } catch (error) {
            logger.error(`[${accountId}] 批量已读失败:`, error);
          }
          queue.keys = [];
        }
        queue.timer = null;
      }, delay);
    }
  } catch (error) {
    logger.error(`[${accountId}] 处理消息失败:`, error);
  }
}

async function handleMessageStatusUpdate(updates, accountId, accountPhone) {
  for (const update of updates || []) {
    try {
      const { key, update: statusUpdate } = update;
      const status = statusUpdate?.status;

      if (status !== 3 && status !== 4) continue;

      const statusMap = { 3: "delivery_ack", 4: "read" };
      const receipt = statusMap[status] || `unknown(${status})`;

      const receiptData = {
        accountId,
        accountPhone,
        messageId: key.id,
        remoteJid: key.remoteJid,
        fromMe: key.fromMe || false,
        receipt,
        receiptTimestamp: statusUpdate.messageTimestamp || Math.floor(Date.now() / 1000),
        participant: key.participant || null,
        MessageType: "msg_status_update",
        statusCode: status,
      };

      await nats.publishMessage("msgs", receiptData);
      await redisStorage.updateMessageStatus(key.id, receipt);
    } catch (error) {
      logger.error(`[${accountId}] 处理消息状态更新失败:`, error);
    }
  }
}

async function handleMessageReceiptUpdate(updates, accountId, accountPhone) {
  for (const update of updates || []) {
    try {
      await nats.publishMessage("msgs", {
        accountId,
        accountPhone,
        remoteJid: update.remoteJid,
        fromMe: update.fromMe || false,
        receiptType: update.type,
        receiptTimestamp: update.timestamp || Math.floor(Date.now() / 1000),
        participant: update.participant || null,
        MessageType: "msg_receipt_update",
      });
    } catch (error) {
      logger.error(`[${accountId}] 处理回执更新失败:`, error);
    }
  }
}

async function handleMessagingHistory(events, accountId, accountPhone) {
  const { chats, contacts } = events["messaging-history.set"] || {};
  try {
    for (const chat of chats || []) {
      const peerId = chat.id;
      let peerPhone = "";

      // 如果 peerId 是 @lid，尝试从其他字段取手机号
      if (peerId && peerId.includes('@lid')) {
        // 可能 chat 里有 phoneNumber 字段？
        // 或者从 contacts 里找对应的手机号
        peerPhone = chat.phoneNumber || "";
      } else {
        // 如果是 @s.whatsapp.net，可以取手机号
        peerPhone = peerId?.split("@")[0] || "";
      }

      await redisStorage.upsertChat({
        id: snowflake.nextId(),
        peerPhone: peerPhone,  // 没有就空着
        peerId: peerId,
        peerName: chat.name || "",
        accountPhone,
        accountId,
        isGroup: peerId?.includes("g.us") || false,
        lastMessageTime: chat.lastMessageRecvTimestamp,
      });
    }

    for (const contact of contacts || []) {
      const peerId = contact.id;
      let peerPhone = "";

      // 优先用 contact.phoneNumber
      if (contact.phoneNumber) {
        peerPhone = contact.phoneNumber;
      } else if (peerId && !peerId.includes('@lid')) {
        peerPhone = peerId.split('@')[0] || "";
      }

      await redisStorage.upsertChat({
        id: snowflake.nextId(),
        peerPhone: peerPhone,
        peerId: peerId,
        peerName: contact.name || contact.notify || "",
        accountId,
        accountPhone,
        isGroup: peerId?.includes("g.us") || false,
      });
    }
  } catch (error) {
    logger.error(`[${accountId}] 保存消息历史失败:`, error);
  }
}

async function handleChatsUpsert(chats, accountId, accountPhone) {
  for (const chat of chats || []) {
    try {
      await redisStorage.upsertChat({
        id: snowflake.nextId(),
        peerPhone: chat.id?.split("@")[0] || chat.id,
        peerId: chat.id,
        peerName: chat.name || "",
        accountPhone,
        accountId,
        isGroup: chat.id?.includes("g.us") || false,
        lastMessageTime: chat.lastMessageRecvTimestamp,
      });
    } catch (error) {
      logger.error(`[${accountId}] 保存聊天失败:`, error);
    }
  }
}

module.exports = {
  handleIncomingMessage,
  handleMessageStatusUpdate,
  handleMessageReceiptUpdate,
  handleMessagingHistory,
  handleChatsUpsert,
};
