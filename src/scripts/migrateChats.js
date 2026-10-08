// src/scripts/migrateChats.js

const { getClient } = require("../config/redis");

// 引入 redisKey
function redisKey(...parts) {
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
}

async function migrateChats() {
  const client = getClient();

  const accountIds = await client.sMembers("accounts:set");
  console.log(`找到 ${accountIds.length} 个账号`);

  let migratedCount = 0;

  for (const accountId of accountIds) {
    const accountPhone = await client.hGet(`account:id:${accountId}`, "phoneNumber");
    if (!accountPhone) continue;

    const oldChatsKey = redisKey("account", accountId, "chats");
    const peerIds = await client.sMembers(oldChatsKey);
    if (!peerIds || peerIds.length === 0) continue;

    console.log(`[${accountPhone}] 迁移 ${peerIds.length} 个联系人`);

    for (const peerId of peerIds) {
      const oldChatKey = redisKey("chat", accountId, peerId);
      const chatData = await client.hGetAll(oldChatKey);
      if (!chatData || Object.keys(chatData).length === 0) continue;

      // ========== 用 redisKey 生成新 key ==========
      const newChatKey = redisKey("chat", accountPhone, peerId);
      await client.hSet(newChatKey, chatData);
      await client.sAdd(redisKey("account", accountPhone, "chats"), peerId);
      migratedCount++;
    }
  }

  console.log(`✅ 迁移完成，共迁移 ${migratedCount} 个联系人`);
  process.exit(0);
}

migrateChats().catch((err) => {
  console.error("迁移失败:", err);
  process.exit(1);
});
