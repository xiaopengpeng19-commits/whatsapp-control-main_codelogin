// test_nats.js
// NATS 测试工具 - 支持发送命令和监听消息

const { connect, StringCodec } = require('nats');

// NATS 连接配置
const NATS_CONFIG = {
  servers: process.env.NATS_HOST || "127.0.0.1:4222",
  user: process.env.NATS_USER || "root",
  pass: process.env.NATS_PASS || "16!8#6QNy12sFtq",
  name: 'whatsapp-test-client',
  reconnect: true,
  maxReconnectAttempts: -1,
};

const sc = StringCodec();

// 生成请求ID
function generateReqId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 6);
}

/**
 * 发送命令到 NATS
 */
async function sendCommand(nc, cmd, account, body = {}) {
  const reqId = generateReqId();
  
  const message = {
    Cmd: cmd,
    ReqId: reqId,
    Account: account,
    Body: body
  };

  console.log(`\n📤 发送命令: ${cmd}`);
  console.log(`   ReqId: ${reqId}`);
  console.log(`   Account: ${account}`);
  console.log(`   Body:`, JSON.stringify(body, null, 2));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Request timeout: ${cmd}`));
    }, 30000);

    nc.request('cmds', sc.encode(JSON.stringify(message)), {
      timeout: 30000
    }).then((response) => {
      clearTimeout(timeout);
      try {
        const result = JSON.parse(sc.decode(response.data));
        console.log(`📥 收到响应:`, JSON.stringify(result, null, 2));
        resolve(result);
      } catch (error) {
        reject(new Error(`Failed to parse response: ${error.message}`));
      }
    }).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * 监听消息（持续监听，直到按 Ctrl+C 退出）
 */
async function listenMessages(nc) {
  console.log('\n' + '='.repeat(60));
  console.log('📡 进入消息监听模式');
  console.log('='.repeat(60));
  console.log('等待接收消息...');
  console.log('按 Ctrl+C 退出监听\n');
  
  const sub = nc.subscribe('msgs');
  let count = 0;
  
  // 记录每条消息的最新状态（用于去重）
  const messageStatusMap = new Map();
  
  for await (const msg of sub) {
    count++;
    try {
      const data = JSON.parse(sc.decode(msg.data));
      
      // 打印原始数据（调试用，可注释掉）
      // console.log(`\n📦 [原始数据 #${count}]`);
      // console.log(JSON.stringify(data, null, 2));
      
      // 1️⃣ 处理状态更新（已送达、已读等）
      if (data.MessageType === 'msg_status_update') {
        const messageId = data.messageId;
        const status = data.receipt;
        const fromMe = data.fromMe;
        
        // 只关心已送达 (delivery_ack) 和已读 (read)
        if (status !== 'delivery_ack' && status !== 'read') {
          continue;
        }
        
        // 如果已经标记为已读，跳过所有后续更新
        if (messageStatusMap.get(messageId) === 'read') {
          continue;
        }
        
        // 如果已经是已送达，但收到已读，更新为已读
        if (status === 'read') {
          messageStatusMap.set(messageId, 'read');
          console.log(`\n👁️ [${fromMe ? '自己发送' : '对方消息'}] ${messageId} -> 已读`);
          if (data.receiptTimestamp) {
            console.log(`   时间: ${new Date(data.receiptTimestamp * 1000).toLocaleString()}`);
          }
        } else if (status === 'delivery_ack' && messageStatusMap.get(messageId) !== 'read') {
          messageStatusMap.set(messageId, 'delivery_ack');
          console.log(`\n✅ [${fromMe ? '自己发送' : '对方消息'}] ${messageId} -> 已送达`);
          if (data.receiptTimestamp) {
            console.log(`   时间: ${new Date(data.receiptTimestamp * 1000).toLocaleString()}`);
          }
        }
        continue;
      }
      
      // 2️⃣ 过滤掉自己发送的消息（只显示别人发来的）
      if (data.fromMe === true) {
        continue;
      }
      
      // 3️⃣ 显示接收到的消息（别人发来的）
      console.log(`\n📩 [消息 #${count}]`);
      console.log(`  类型: ${data.MessageType || data.type || '未知'}`);
      console.log(`  来自: ${data.pushName || '未知'} (${data.accountPhone || data.accountId || 'N/A'})`);
      
      // 获取文本内容
      let text = '';
      if (data.content) {
        text = data.content;
      } else if (data.message) {
        text = data.message.conversation || 
               data.message.extendedTextMessage?.text || 
               data.message.imageMessage?.caption ||
               '(非文本消息)';
      }
      console.log(`  内容: ${text}`);
      
      // 显示媒体信息
      if (data.mediaInfo) {
        if (data.mediaInfo.mimetype) {
          console.log(`  媒体类型: ${data.mediaInfo.mimetype}`);
        }
        if (data.mediaInfo.url) {
          console.log(`  媒体URL: ${data.mediaInfo.url}`);
        }
        if (data.mediaInfo.fileName) {
          console.log(`  文件名: ${data.mediaInfo.fileName}`);
        }
      }
      
      if (data.timestamp) {
        console.log(`  时间: ${new Date(data.timestamp * 1000).toLocaleString()}`);
      }
      console.log(`  消息ID: ${data.messageId}`);
      
    } catch (error) {
      console.error('❌ 解析消息失败:', error.message);
      console.error('原始数据:', msg.data);
    }
  }
}

/**
 * 测试发送文本消息
 */
async function testSendTextMsg(nc) {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 测试: 发送文本消息 (SendTextMsg)');
  console.log('='.repeat(50));

  const body = {
    To: "8618939797045",
    Text: "你好，这是一条来自 NATS 的测试消息！时间: " + new Date().toLocaleString(),
    DeleteForMe: false
  };

  try {
    const result = await sendCommand(nc, 'SendTextMsg', '8615239719312', body);
    console.log('✅ 文本消息发送成功');
    return result;
  } catch (error) {
    console.error('❌ 文本消息发送失败:', error.message);
    throw error;
  }
}

/**
 * 测试发送图片消息
 */
async function testSendImageMsg(nc) {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 测试: 发送图片消息 (SendImageMsg)');
  console.log('='.repeat(50));

  const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  
  const body = {
    To: "8618939797045",
    Base64Content: base64Image,
    Caption: "这是一张测试图片",
    DeleteForMe: false
  };

  try {
    const result = await sendCommand(nc, 'SendImageMsg', '8615239719312', body);
    console.log('✅ 图片消息发送成功');
    return result;
  } catch (error) {
    console.error('❌ 图片消息发送失败:', error.message);
    throw error;
  }
}

/**
 * 测试发送链接消息（带按钮）
 */
async function testSendLinkMessage(nc) {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 测试: 发送链接消息 (SendLinkMessage)');
  console.log('='.repeat(50));

  const body = {
    to: "8618939797045",
    title: "📢 产品介绍",
    body: "我们最新的产品已经上线，欢迎查看详细信息和购买。",
    footer: "点击下方按钮访问产品页面",
    imageUrl: "https://www.baidu.com/img/PCtm_d9c8750bed0b3c7d089fa7d55720d6cf.png",
    buttons: [
      {
        name: "cta_url",
        display_text: "查看产品",
        url: "https://www.bilibili.com/"
      }
    ]
  };

  try {
    const result = await sendCommand(nc, 'SendLinkMessage', '8615239719312', body);
    console.log('✅ 链接消息发送成功');
    return result;
  } catch (error) {
    console.error('❌ 链接消息发送失败:', error.message);
    throw error;
  }
}

/**
 * 测试获取账号状态
 */
async function testGetAccountState(nc) {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 测试: 获取账号状态 (GetAccountState)');
  console.log('='.repeat(50));

  try {
    const result = await sendCommand(nc, 'GetAccountState', '8615239719312', {});
    console.log('✅ 账号状态:', result);
    return result;
  } catch (error) {
    console.error('❌ 获取账号状态失败:', error.message);
    throw error;
  }
}

/**
 * 测试上线账号
 */
async function testOnline(nc) {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 测试: 上线账号 (Online)');
  console.log('='.repeat(50));

  try {
    const result = await sendCommand(nc, 'Online', '8615239719312', {});
    console.log('✅ 上线结果:', result);
    return result;
  } catch (error) {
    console.error('❌ 上线失败:', error.message);
    throw error;
  }
}

/**
 * 测试获取联系人列表
 */
async function testContactsList(nc) {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 测试: 获取联系人列表 (ContactsList)');
  console.log('='.repeat(50));

  try {
    const result = await sendCommand(nc, 'ContactsList', '8615239719312', {});
    console.log('✅ 联系人列表:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('❌ 获取联系人列表失败:', error.message);
    throw error;
  }
}

/**
 * 测试获取账号列表
 */
async function testGetAccountList(nc) {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 测试: 获取账号列表 (GetAccoutList)');
  console.log('='.repeat(50));

  try {
    const result = await sendCommand(nc, 'GetAccoutList', '', {});
    console.log('✅ 账号列表:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('❌ 获取账号列表失败:', error.message);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'all';
  
  console.log('🚀 NATS 测试客户端');
  console.log('='.repeat(50));
  console.log(`模式: ${mode}`);
  console.log('NATS 服务器:', NATS_CONFIG.servers);
  console.log('用户名:', NATS_CONFIG.user);
  console.log('='.repeat(50));

  let nc = null;

  try {
    // 连接 NATS
    console.log('\n🔗 正在连接 NATS...');
    nc = await connect(NATS_CONFIG);
    console.log('✅ NATS 连接成功！');

    await new Promise(resolve => setTimeout(resolve, 1000));

    if (mode === 'listen') {
      // 仅监听模式
      await listenMessages(nc);
      
    } else if (mode === 'send') {
      // 仅发送模式
      console.log('\n📤 发送测试消息...');
      await testGetAccountState(nc);
      await testOnline(nc);
      await testSendTextMsg(nc);
      await testSendLinkMessage(nc);
      console.log('\n✅ 发送完成！');
      
    } else {
      // 完整测试模式：先发送，然后监听
      console.log('\n📤 发送测试消息...');
      await testGetAccountState(nc);
      await testOnline(nc);
      await testContactsList(nc);
      await testGetAccountList(nc);
      await testSendTextMsg(nc);
      await testSendLinkMessage(nc);
      
      // 进入监听模式
      await listenMessages(nc);
    }

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    if (nc) {
      console.log('\n🔌 关闭 NATS 连接...');
      await nc.drain();
      console.log('✅ NATS 连接已关闭');
    }
    process.exit(0);
  }
}

// 使用说明
console.log(`
📖 使用方法:
  node test_nats.js           - 完整测试（发送 + 监听）
  node test_nats.js send      - 仅发送测试消息
  node test_nats.js listen    - 仅监听接收消息
`);

// 如果直接运行此文件，执行主函数
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  sendCommand,
  listenMessages,
  testSendTextMsg,
  testSendImageMsg,
  testSendLinkMessage,
  testGetAccountState,
  testOnline,
  testContactsList,
  testGetAccountList
};