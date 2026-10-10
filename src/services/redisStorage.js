const { getClient } = require("../config/redis");
const nats = require("../config/nats");
const { redis } = require("../utils/logger");
const logger = redis;
const ACCOUNT_SET = "accounts:set";

function redisKey(...parts) {
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
}

function parseValue(value, key) {
  if (value === undefined || value === null) {
    return null;
  }

  // ========== 保护特定字段 ==========
  if (key === "accountId" || key === "id" || key === "phoneNumber") {
    return String(value);
  }

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function parseObject(object) {
  if (!object || Object.keys(object).length === 0) {
    return null;
  }

  const parsed = {};
  for (const [key, value] of Object.entries(object)) {
    parsed[key] = parseValue(value, key); // ← 传递 key
  }
  return parsed;
}

function flattenObject(object) {
  const flat = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue;
    if (key === "phoneNumber" && value !== undefined) {
      flat[key] = String(value); // ← 强制转为字符串
    } else if (typeof value === "object") {
      flat[key] = JSON.stringify(value);
    } else {
      flat[key] = String(value);
    }
  }
  return flat;
}

function getAccountKey(accountId) {
  return redisKey("account", "id", accountId);
}

function getAccountPhoneKey(phoneNumber) {
  return redisKey("account", "phone", phoneNumber);
}

// ========== 新的 key 函数（用手机号）==========
function getChatKey(accountPhone, peerId) {
  return redisKey("chat", accountPhone, peerId);
}

function getAccountChatsSetKey(accountPhone) {
  return redisKey("account", accountPhone, "chats");
}

// ========== 兼容旧 key（用 accountId）==========
function getOldChatKey(accountId, peerId) {
  return redisKey("chat", accountId, peerId);
}

function getOldAccountChatsSetKey(accountId) {
  return redisKey("account", accountId, "chats");
}

function getGroupKey(accountId, groupId) {
  return redisKey("group", accountId, groupId);
}

function getAccountGroupsSetKey(accountId) {
  return redisKey("account", accountId, "groups");
}

function getMessageKey(messageId) {
  return redisKey("message", messageId);
}

function getChatMessagesKey(chatId) {
  return redisKey("chat", chatId, "messages");
}

async function getAccountById(accountId) {
  const client = getClient();
  const data = await client.hGetAll(getAccountKey(accountId));
  return parseObject(data);
}

async function getAccountByPhone(phoneNumber) {
  const client = getClient();
  const accountId = await client.get(getAccountPhoneKey(phoneNumber));
  if (!accountId) {
    return null;
  }
  return getAccountById(accountId);
}

async function getAccountByPhoneOrId(identifier) {
  const byId = await getAccountById(identifier);
  if (byId) {
    return byId;
  }

  return getAccountByPhone(identifier);
}

async function getAllAccounts() {
  const client = getClient();
  const ids = await client.sMembers(ACCOUNT_SET);
  if (!ids || ids.length === 0) {
    return [];
  }

  const accounts = await Promise.all(
    ids.map(async (id) => {
      const data = await client.hGetAll(getAccountKey(id));
      return parseObject(data);
    }),
  );

  // ========== 过滤：只返回有 phoneNumber 的账号 ==========
  return accounts.filter((acc) => acc && acc.phoneNumber);
}

// src/services/redisStorage.js

async function upsertAccount(account) {
  const client = getClient();
  const accountId = String(account.id);
  const accountKey = getAccountKey(accountId);

  // ========== 如果没有 phoneNumber，不保存（或只保存不加入列表） ==========
  if (!account.phoneNumber) {
    // 直接保存但不加入 accounts:set（这样 getAllAccounts 不会返回它）
    const now = new Date().toISOString();
    const updated = {
      ...account,
      updatedAt: now,
      createdAt: now,
    };
    await client.hSet(accountKey, flattenObject(updated));
    return updated;
  }

  // ========== 按 phoneNumber 去重：删除旧的同号码账号 ==========
  const existingPhoneAccountId = await client.get(getAccountPhoneKey(account.phoneNumber));
  if (existingPhoneAccountId && existingPhoneAccountId !== accountId) {
    // 删除旧的账号
    const oldAccountKey = getAccountKey(existingPhoneAccountId);
    const oldData = await client.hGetAll(oldAccountKey);
    if (oldData && Object.keys(oldData).length > 0) {
      await client.del(oldAccountKey);
      await client.sRem(ACCOUNT_SET, existingPhoneAccountId);
      logger.info(`[upsertAccount] 删除重复账号: ${existingPhoneAccountId} (phone: ${account.phoneNumber})`);
    }
  }

  // ========== 正常保存 ==========
  const existingData = await client.hGetAll(accountKey);
  const existingAccount = parseObject(existingData) || {};

  if (!existingAccount.id) {
    await client.sAdd(ACCOUNT_SET, accountId);
  }

  if (account.phoneNumber && existingAccount.phoneNumber && existingAccount.phoneNumber !== account.phoneNumber) {
    await client.del(getAccountPhoneKey(existingAccount.phoneNumber));
  }

  if (account.phoneNumber) {
    await client.set(getAccountPhoneKey(account.phoneNumber), accountId);
  }

  const now = new Date().toISOString();
  const updated = {
    ...existingAccount,
    ...account,
    updatedAt: now,
    createdAt: existingAccount.createdAt || now,
  };

  await client.hSet(accountKey, flattenObject(updated));

  return updated;
}

async function updateAccount(accountId, fields) {
  const client = getClient();
  const existing = await getAccountById(accountId);
  if (!existing) {
    throw new Error(`Account not found: ${accountId}`);
  }

  if (fields.phoneNumber && existing.phoneNumber && existing.phoneNumber !== fields.phoneNumber) {
    await client.del(getAccountPhoneKey(existing.phoneNumber));
    await client.set(getAccountPhoneKey(fields.phoneNumber), accountId);
  }

  const updated = {
    ...existing,
    ...fields,
    updatedAt: new Date().toISOString(),
  };

  await client.hSet(getAccountKey(accountId), flattenObject(updated));

  return updated;
}

// src/services/redisStorage.js

async function deleteAccount(accountId) {
  const client = getClient();
  const existing = await getAccountById(accountId);
  if (!existing) {
    return false;
  }

  if (existing.phoneNumber) {
    await client.del(getAccountPhoneKey(existing.phoneNumber));
  }

  // ========== 确保 accountId 是字符串 ==========
  const id = String(accountId);
  await client.sRem(ACCOUNT_SET, id);

  // ========== 不删除联系人和群组 ==========
  // await deleteChatsByAccountId(id);
  // await deleteGroupsByAccountId(id);

  await client.del(getAccountKey(id));
  return true;
}

async function upsertChat(chat) {
  const client = getClient();

  // ========== 1. accountPhone 必填 ==========
  const accountPhone = chat.accountPhone;
  if (!accountPhone) {
    logger.debug(`[upsertChat] 跳过：accountPhone 为空`);
    return null;
  }

  // ========== 2. 统一清洗 peerPhone ==========
  let peerPhone = String(chat.peerPhone || "").trim();
  if (peerPhone.includes("@")) {
    logger.warn(`[upsertChat] 收到带 @ 的 peerPhone: ${chat.peerPhone}, peerId: ${chat.peerId}, accountPhone: ${accountPhone}`);
    peerPhone = peerPhone.split("@")[0];
  }
  // 去掉非数字字符（保留纯数字）
  peerPhone = peerPhone.replace(/[^\d]/g, "");

  const peerId = chat.peerId || "";

  // ========== 3. 过滤规则 ==========
  if (!peerId || !peerId.includes("@lid")) {
    logger.debug(`[upsertChat] 跳过非 lid 格式: peerId=${peerId}`);
    return null;
  }
  if (peerPhone === "0" || peerPhone === "") {
    logger.debug(`[upsertChat] 跳过无效手机号: peerPhone=${peerPhone}`);
    return null;
  }
  if (peerPhone === String(peerId.split("@")[0])) {
    return null;
  }
  if (chat.isGroup) {
    return null;
  }
  if (peerId.includes("@newsletter")) {
    return null;
  }

  // ========== 4. 用清洗后的 peerPhone 覆盖 ==========
  chat.peerPhone = peerPhone;

  // ========== 5. 用手机号查重 ==========
  const existingChats = await getChatsByAccountPhone(accountPhone);
  let existingChat = null;
  for (const c of existingChats) {
    if (String(c.peerPhone) === String(peerPhone)) {
      existingChat = c;
      break;
    }
  }

  const now = new Date().toISOString();
  let isNew = false;
  let result = null;

  if (existingChat) {
    // 更新
    const chatKey = getChatKey(accountPhone, existingChat.peerId);
    const updatedChat = { ...existingChat, ...chat, updatedAt: now };
    await client.hSet(chatKey, flattenObject(updatedChat));
    result = { ...updatedChat, isNew: false };
  } else {
    // 新增
    const chatKey = getChatKey(accountPhone, peerId);
    const newChat = { ...chat, createdAt: now, updatedAt: now };
    await client.sAdd(getAccountChatsSetKey(accountPhone), peerId);
    await client.hSet(chatKey, flattenObject(newChat));
    result = { ...newChat, isNew: true };
    isNew = true;
  }

  // ========== 6. 推送 contact.event ==========
  try {
    await nats.publishMessage("contact.event", {
      accountId: chat.accountId,
      accountPhone: accountPhone,
      eventType: isNew ? "contact.upsert" : "contact.update",
      data: {
        peerPhone: result.peerPhone,
        peerId: result.peerId,
        peerName: result.peerName,
        isGroup: false,
      },
      timestamp: now,
    });
  } catch (err) {
    logger.error(`[upsertChat] 推送失败:`, err);
  }

  return result;
}

async function getChatsByAccountId(accountId) {
  const client = getClient();
  const peerIds = await client.sMembers(getAccountChatsSetKey(accountId));
  if (!peerIds || peerIds.length === 0) {
    return [];
  }

  const chats = await Promise.all(
    peerIds.map(async (peerId) => {
      const data = await client.hGetAll(getChatKey(accountId, peerId));
      return parseObject(data);
    }),
  );

  // ========== 过滤掉错误数据 ==========
  return chats.filter((chat) => {
    if (!chat) return false;
    // 过滤：peerPhone 是 LID 冒充的手机号
    if (chat.peerId && chat.peerId.includes("@lid") && chat.peerPhone) {
      const lidNumber = chat.peerId.split("@")[0];
      if (chat.peerPhone === lidNumber) {
        return false;
      }
    }
    // 过滤：peerPhone 为空
    if (!chat.peerPhone || String(chat.peerPhone) === "0") {
      return false;
    }
    return true;
  });
}

async function deleteChatsByAccountId(accountId) {
  const client = getClient();
  const peerIds = await client.sMembers(getAccountChatsSetKey(accountId));
  if (!peerIds || peerIds.length === 0) {
    await client.del(getAccountChatsSetKey(accountId));
    return;
  }

  const pipeline = client.multi();
  peerIds.forEach((peerId) => pipeline.del(getChatKey(accountId, peerId)));
  pipeline.del(getAccountChatsSetKey(accountId));
  await pipeline.exec();
}

// src/services/redisStorage.js

async function getContactsByAccountId(accountId) {
  const chats = await getChatsByAccountId(accountId);

  // ========== 过滤掉错误数据 ==========
  return chats.filter((chat) => {
    // 过滤：peerPhone 是 LID 冒充的手机号
    if (chat.peerId && chat.peerId.includes("@lid") && chat.peerPhone) {
      const lidNumber = chat.peerId.split("@")[0];
      if (chat.peerPhone === lidNumber) {
        return false; // 过滤掉
      }
    }
    // 过滤：peerPhone 为空
    if (!chat.peerPhone || String(chat.peerPhone) === "0") {
      return false;
    }
    // 过滤：群聊
    if (chat.isGroup === true || chat.isGroup === "true") {
      return false;
    }
    return true;
  });
}

async function saveGroup(group) {
  const client = getClient();
  const groupKey = getGroupKey(group.accountId, group.groupId);
  const now = new Date().toISOString();
  const existingData = await client.hGetAll(groupKey);
  const existingGroup = parseObject(existingData) || {};

  if (!existingData || Object.keys(existingData).length === 0) {
    await client.sAdd(getAccountGroupsSetKey(group.accountId), group.groupId);
  }

  const updatedGroup = {
    ...existingGroup,
    ...group,
    updatedAt: now,
    createdAt: existingGroup.createdAt || now,
  };

  await client.hSet(groupKey, flattenObject(updatedGroup));
  return updatedGroup;
}

async function getGroupsByAccountId(accountId) {
  const client = getClient();
  const groupIds = await client.sMembers(getAccountGroupsSetKey(accountId));
  if (!groupIds || groupIds.length === 0) {
    return [];
  }

  const groups = await Promise.all(
    groupIds.map(async (groupId) => {
      const data = await client.hGetAll(getGroupKey(accountId, groupId));
      return parseObject(data);
    }),
  );
  return groups.filter(Boolean);
}

async function deleteGroupsByAccountId(accountId) {
  const client = getClient();
  const groupIds = await client.sMembers(getAccountGroupsSetKey(accountId));
  if (!groupIds || groupIds.length === 0) {
    await client.del(getAccountGroupsSetKey(accountId));
    return;
  }

  const pipeline = client.multi();
  groupIds.forEach((groupId) => pipeline.del(getGroupKey(accountId, groupId)));
  pipeline.del(getAccountGroupsSetKey(accountId));
  await pipeline.exec();
}

async function getGroupById(accountId, groupId) {
  const data = await getClient().hGetAll(getGroupKey(accountId, groupId));
  return parseObject(data);
}

async function saveMessage(message) {
  const client = getClient();
  const messageKey = getMessageKey(message.messageId);
  const exists = await client.exists(messageKey);
  const now = new Date().toISOString();
  const payload = {
    accountId: message.accountId,
    accountPhone: message.accountPhone,
    messageId: message.messageId,
    remoteJid: message.remoteJid,
    fromMe: message.fromMe,
    timestamp: message.timestamp,
    pushName: message.pushName,
    content: message.content,
    messageType: message.MessageType,
    participant: message.participant,
    originalMessageType: message.originalMessageType,
    receipt: message.receipt,
    message: message.message ? JSON.stringify(message.message) : null,
    mediaInfo: message.mediaInfo ? JSON.stringify(message.mediaInfo) : null,
    createdAt: now,
    updatedAt: now,
    chatId: message.remoteJid,
  };

  await client.hSet(messageKey, flattenObject(payload));
  if (!exists && message.remoteJid) {
    await client.lPush(getChatMessagesKey(message.remoteJid), message.messageId);
  }
  return parseObject(await client.hGetAll(messageKey));
}

async function getMessageById(messageId) {
  const data = await getClient().hGetAll(getMessageKey(messageId));
  return parseObject(data);
}

async function getMessagesByChat(chatId, limit = 50, offset = 0) {
  const client = getClient();
  const messageIds = await client.lRange(getChatMessagesKey(chatId), offset, offset + limit - 1);
  if (!messageIds || messageIds.length === 0) {
    return [];
  }

  const messages = await Promise.all(
    messageIds.map(async (messageId) => {
      const messageData = await client.hGetAll(getMessageKey(messageId));
      return parseObject(messageData);
    }),
  );
  return messages.filter(Boolean);
}
// src/services/redisStorage.js

async function getChatsByAccountPhone(accountPhone) {
  const client = getClient();
  const peerIds = await client.sMembers(getAccountChatsSetKey(accountPhone));
  if (!peerIds || peerIds.length === 0) {
    return [];
  }

  const chats = await Promise.all(
    peerIds.map(async (peerId) => {
      const data = await client.hGetAll(getChatKey(accountPhone, peerId));
      return parseObject(data);
    }),
  );
  return chats.filter(Boolean);
}

async function getContactsByAccountPhone(accountPhone) {
  const chats = await getChatsByAccountPhone(accountPhone);
  return chats.filter((chat) => chat.isGroup === false || chat.isGroup === "false" || chat.isGroup === 0 || chat.isGroup === "0");
}
async function updateMessageStatus(messageId, status) {
  const client = getClient();
  const messageKey = getMessageKey(messageId);
  const exists = await client.exists(messageKey);
  if (!exists) {
    throw new Error("Message not found");
  }
  await client.hSet(messageKey, flattenObject({ status, updatedAt: new Date().toISOString() }));
  return parseObject(await client.hGetAll(messageKey));
}

// ========== 同步标志 ==========
function getAccountSyncKey(phoneNumber) {
  return `account:sync:${phoneNumber}`;
}

async function getAccountSyncFlag(phoneNumber) {
  if (!phoneNumber) return false;
  const client = getClient();
  const value = await client.get(getAccountSyncKey(phoneNumber));
  return value === "true";
}

async function setAccountSyncFlag(phoneNumber, synced = true) {
  if (!phoneNumber) return;
  const client = getClient();
  await client.set(getAccountSyncKey(phoneNumber), String(synced));
}

async function deleteAccountSyncFlag(phoneNumber) {
  if (!phoneNumber) return;
  const client = getClient();
  await client.del(getAccountSyncKey(phoneNumber));
}

module.exports = {
  getAccountById,
  getAccountByPhone,
  getAccountByPhoneOrId,
  getAllAccounts,
  upsertAccount,
  updateAccount,
  deleteAccount,
  upsertChat,
  getChatsByAccountId,
  deleteChatsByAccountId,
  getContactsByAccountId,
  saveGroup,
  getGroupsByAccountId,
  getGroupById,
  saveMessage,
  getMessageById,
  getMessagesByChat,
  updateMessageStatus,
  getAccountSyncFlag,
  setAccountSyncFlag,
  deleteAccountSyncFlag,
  getChatsByAccountPhone,
  getContactsByAccountPhone,
};
