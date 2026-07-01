const { getClient } = require('../config/redis');
const nats = require('../config/nats');

const ACCOUNT_SET = 'accounts:set';

function redisKey(...parts) {
  return parts.map(part => encodeURIComponent(String(part))).join(':');
}

function parseValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
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
    parsed[key] = parseValue(value);
  }
  return parsed;
}

function flattenObject(object) {
  const flat = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'object') {
      flat[key] = JSON.stringify(value);
    } else {
      flat[key] = String(value);
    }
  }
  return flat;
}

function getAccountKey(accountId) {
  return redisKey('account', 'id', accountId);
}

function getAccountPhoneKey(phoneNumber) {
  return redisKey('account', 'phone', phoneNumber);
}

function getAccountChatsSetKey(accountId) {
  return redisKey('account', accountId, 'chats');
}

function getChatKey(accountId, peerId) {
  return redisKey('chat', accountId, peerId);
}

function getGroupKey(accountId, groupId) {
  return redisKey('group', accountId, groupId);
}

function getAccountGroupsSetKey(accountId) {
  return redisKey('account', accountId, 'groups');
}

function getMessageKey(messageId) {
  return redisKey('message', messageId);
}

function getChatMessagesKey(chatId) {
  return redisKey('chat', chatId, 'messages');
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
    })
  );

  return accounts.filter(Boolean);
}

async function upsertAccount(account) {
  const client = getClient();
  const accountId = String(account.id);
  const accountKey = getAccountKey(accountId);
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
    createdAt: existingAccount.createdAt || now
  };

  await client.hSet(accountKey, flattenObject(updated));


  if(account.phoneNumber){
    // 构建回执数据
    const connectionData = {
      accountId: accountId,
      accountPhone: account.phoneNumber,
      updatedAt: now,
      accountStatus: account.account_status
    };
      
    // 发布回执更新到 NATS
    await nats.publishMessage(`connection`, connectionData);
  }
  
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
    updatedAt: new Date().toISOString()
  };

  await client.hSet(getAccountKey(accountId), flattenObject(updated));
  return updated;
}

async function deleteAccount(accountId) {
  const client = getClient();
  const existing = await getAccountById(accountId);
  if (!existing) {
    return false;
  }

  if (existing.phoneNumber) {
    await client.del(getAccountPhoneKey(existing.phoneNumber));
  }

  await client.sRem(ACCOUNT_SET, accountId);
  await deleteChatsByAccountId(accountId);
  await deleteGroupsByAccountId(accountId);
  await client.del(getAccountKey(accountId));
  return true;
}

async function upsertChat(chat) {
  const client = getClient();
  const chatKey = getChatKey(chat.accountId, chat.peerId);
  const existingData = await client.hGetAll(chatKey);
  const existingChat = parseObject(existingData) || {};

  if (!existingData || Object.keys(existingData).length === 0) {
    await client.sAdd(getAccountChatsSetKey(chat.accountId), chat.peerId);
  }

  const now = new Date().toISOString();
  const updatedChat = {
    ...existingChat,
    ...chat,
    updatedAt: now,
    createdAt: existingChat.createdAt || now
  };

  await client.hSet(chatKey, flattenObject(updatedChat));
  return updatedChat;
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
    })
  );
  return chats.filter(Boolean);
}

async function deleteChatsByAccountId(accountId) {
  const client = getClient();
  const peerIds = await client.sMembers(getAccountChatsSetKey(accountId));
  if (!peerIds || peerIds.length === 0) {
    await client.del(getAccountChatsSetKey(accountId));
    return;
  }

  const pipeline = client.multi();
  peerIds.forEach(peerId => pipeline.del(getChatKey(accountId, peerId)));
  pipeline.del(getAccountChatsSetKey(accountId));
  await pipeline.exec();
}

async function getContactsByAccountId(accountId) {
  const chats = await getChatsByAccountId(accountId);
  return chats.filter(chat => chat.isGroup === false || chat.isGroup === 'false' || chat.isGroup === 0 || chat.isGroup === '0');
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
    createdAt: existingGroup.createdAt || now
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
    })
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
  groupIds.forEach(groupId => pipeline.del(getGroupKey(accountId, groupId)));
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
    chatId: message.remoteJid
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
    })
  );
  return messages.filter(Boolean);
}

async function updateMessageStatus(messageId, status) {
  const client = getClient();
  const messageKey = getMessageKey(messageId);
  const exists = await client.exists(messageKey);
  if (!exists) {
    throw new Error('Message not found');
  }
  await client.hSet(messageKey, flattenObject({ status, updatedAt: new Date().toISOString() }));
  return parseObject(await client.hGetAll(messageKey));
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
  updateMessageStatus
};
