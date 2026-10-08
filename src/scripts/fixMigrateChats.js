// src/scripts/fixMigrateChats.js

const { getClient } = require("../config/redis");

function redisKey(...parts) {
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
}

async function fixMigrateChats() {
  const client = getClient();

  // ========== 扫描所有 chat key，反推 accountId ==========
  const chatKeys = await client.keys("account:*:chats");
  console.log(`找到 ${chatKeys.length} 个 chat set`);

  let migratedCount = 0;
  let migratedAccounts = 0;

  for (const key of chatKeys) {
    // 从 key 中提取 accountId
    const match = key.match(/^account:(.+):chats$/);
    if (!match) continue;
    const accountId = match[1];

    // 获取手机号
    const accountPhone = await client.hGet(`account:id:${accountId}`, "phoneNumber");
    if (!accountPhone) continue;

    // 如果 accountId === accountPhone，跳过
    if (String(accountId) === String(accountPhone)) continue;

    // 旧 key 的 peerId
    const oldPeerIds = await client.sMembers(key);
    if (!oldPeerIds || oldPeerIds.length === 0) continue;

    // 新 key 的数量
    const newChatsKey = redisKey("account", accountPhone, "chats");
    const newCount = await client.sCard(newChatsKey);

    // 如果新 key 已有数据，跳过
    if (newCount > 0) {
      console.log(`[${accountPhone}] 新 key 已有 ${newCount} 个，跳过`);
      continue;
    }

    // 迁移
    console.log(`[${accountPhone}] 迁移 ${oldPeerIds.length} 个联系人`);
    let count = 0;

    for (const peerId of oldPeerIds) {
      const oldChatKey = redisKey("chat", accountId, peerId);
      const chatData = await client.hGetAll(oldChatKey);
      if (!chatData || Object.keys(chatData).length === 0) continue;

      const newChatKey = redisKey("chat", accountPhone, peerId);
      await client.hSet(newChatKey, chatData);
      await client.sAdd(newChatsKey, peerId);
      count++;
    }

    migratedCount += count;
    migratedAccounts++;
    console.log(`  ✅ 迁移 ${count} 个`);
  }

  console.log(`\n✅ 修复完成`);
  console.log(`  迁移账号: ${migratedAccounts}`);
  console.log(`  迁移联系人: ${migratedCount}`);
  process.exit(0);
}

fixMigrateChats().catch((err) => {
  console.error("修复失败:", err);
  process.exit(1);
});