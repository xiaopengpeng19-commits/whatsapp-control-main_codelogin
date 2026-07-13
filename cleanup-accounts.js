// scripts/cleanup-accounts.js

const redisStorage = require('./src/services/redisStorage');

async function cleanupAccounts() {
  console.log('🔍 开始清理账号数据...');
  
  const accounts = await redisStorage.getAllAccounts();
  console.log(`📊 当前账号总数: ${accounts.length}`);
  
  const phoneMap = new Map();
  const toDelete = [];
  const noPhone = [];
  
  for (const acc of accounts) {
    // 1. 收集无号码的账号
    if (!acc.phoneNumber) {
      noPhone.push(acc.id);
      continue;
    }
    
    // 2. 按 phoneNumber 去重，保留最新的
    const key = String(acc.phoneNumber);
    if (!phoneMap.has(key)) {
      phoneMap.set(key, acc);
    } else {
      const existing = phoneMap.get(key);
      // 保留 updatedAt 更新的
      if (new Date(acc.updatedAt) > new Date(existing.updatedAt)) {
        toDelete.push(existing.id);
        phoneMap.set(key, acc);
      } else {
        toDelete.push(acc.id);
      }
    }
  }
  
  console.log(`📌 无号码账号: ${noPhone.length} 个`);
  console.log(`📌 重复账号: ${toDelete.length} 个`);
  console.log(`📌 保留账号: ${phoneMap.size} 个`);
  
  // 确认后删除
  const allToDelete = [...noPhone, ...toDelete];
  console.log(`\n🗑️ 将删除 ${allToDelete.length} 个账号:`);
  console.log(allToDelete.slice(0, 10).join(', '), allToDelete.length > 10 ? '...' : '');
  
  // 执行删除
  for (const id of allToDelete) {
    await redisStorage.deleteAccount(id);
    console.log(`✅ 删除: ${id}`);
  }
  
  console.log(`\n✅ 清理完成！剩余账号: ${phoneMap.size} 个`);
  process.exit(0);
}

cleanupAccounts().catch(err => {
  console.error('❌ 清理失败:', err);
  process.exit(1);
});