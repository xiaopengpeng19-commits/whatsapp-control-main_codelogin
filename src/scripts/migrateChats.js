// scripts/migrateChats.js

const redisStorage = require("../src/services/redisStorage");
const { getClient } = require("../src/config/redis");

async function migrateChats() {
  const client = getClient();

  // 1. 获取所有账号
  const accountIds = await client.sMembers("accounts:set");
  console.log(`找到 ${accountIds.length} 个账号`);

  let migratedCount = 0;

  for (const accountId of accountIds) {
    // 2. 获取账号手机号
    const accountPhone = await client.hGet(`account:id:${accountId}`, "phoneNumber");
    if (!accountPhone) {
      console.log(`[${accountId}] 没有手机号，跳过`);
      continue;
    }

    // 3. 检查旧 key 是否有数据
    const oldChatsKey = `account:${accountId}:chats`;
    const peerIds = await client.sMembers(oldChatsKey);
    if (!peerIds || peerIds.length === 0) {
      continue;
    }

    console.log(`[${accountPhone}] 迁移 ${peerIds.length} 个联系人`);

    // 4. 迁移每个联系人
    for (const peerId of peerIds) {
      const oldChatKey = `chat:${accountId}:${peerId}`;
      const chatData = await client.hGetAll(oldChatKey);
      if (!chatData || Object.keys(chatData).length === 0) continue;

      // 写入新 key（用手机号）
      const newChatKey = `chat:${accountPhone}:${peerId}`;
      await client.hSet(newChatKey, chatData);
      await client.sAdd(`account:${accountPhone}:chats`, peerId);
      migratedCount++;
    }

    // 5. 可选：删除旧 key
    // await client.del(oldChatsKey);
    // for (const peerId of peerIds) {
    //   await client.del(`chat:${accountId}:${peerId}`);
    // }
  }

  console.log(`✅ 迁移完成，共迁移 ${migratedCount} 个联系人`);
  process.exit(0);
}

migrateChats().catch(console.error);
