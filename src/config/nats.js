const { connect } = require('nats');
const logger = require('../utils/logger');

let natsConnection = null;

/**
 * Connect to NATS server
 * @returns {Promise<Object>} - NATS connection
 */
async function connectNats() {
  try {
    // 使用分离的认证参数避免 URL 编码问题
    const connectionOptions = {
      servers: process.env.NATS_HOST || "127.0.0.1:4222",
      user: process.env.NATS_USER || "root",
      pass: process.env.NATS_PASS || "16!8#6QNy12sFtq",
      name: 'whatsapp-service',
      reconnect: true,
      maxReconnectAttempts: -1, // infinite reconnects
    };
    
    natsConnection = await connect(connectionOptions);
    
    logger.info('Connected to NATS server');
    
    // 等待连接完全建立后再设置订阅
    await cmdpoll();
    
    // Setup disconnect handler
    natsConnection.closed().then(() => {
      logger.info('NATS connection closed');
      natsConnection = null;
    });
    
    return natsConnection;
  } catch (error) {
    logger.error('Failed to connect to NATS:', error);
    return null;
  }
}

async function cmdpoll() {
  console.log("cmdpoll");
  
  // 直接使用已建立的连接，而不是重新获取
  if (!natsConnection) {
    logger.error('NATS connection not available for cmdpoll');
    return;
  }
  
  // 延迟加载服务以避免循环依赖
  const accountService = require('../services/account');
  const messageService = require('../services/message');
  
  const Cmds = {
    "GetAccountState": (Account, Body) => accountService.GetAccountState.call(accountService, Account, Body),
    "Online": (Account, Body) => accountService.Online.call(accountService, Account, Body),
    "Offline": (Account, Body) => accountService.Offline.call(accountService, Account, Body),
    "Delete": (Account, Body) => accountService.DeleteAccount.call(accountService, Account, Body),
    "Query": (Account, Body) => accountService.Query.call(accountService, Account, Body),
    "BindProxy": (Account, Body) => accountService.BindProxy.call(accountService, Account, Body),
    "ContactsList": (Account, Body) => accountService.ContactsList.call(accountService, Account, Body),
    "AddContacts": (Account, Body) => accountService.AddContacts.call(accountService, Account, Body),
    "AddContactsBatch": (Account, Body) => accountService.AddContactsBatch.call(accountService, Account, Body),
    "SendTextMsg": (Account, Body) => messageService.SendTextMsg.call(messageService, Account, Body),
    "SendImageMsg": (Account, Body) => messageService.SendImageMsg.call(messageService, Account, Body),
    "SendVideoMsg": (Account, Body) => messageService.SendVideoMsg.call(messageService, Account, Body),
    "GetQRCode": (Account, Body) => accountService.GetQRCode.call(accountService, Account, Body),
    "GetAccoutList": (Account, Body) => accountService.GetAccoutList.call(accountService, Account, Body),
    "SendLinkMessage": (Account, Body) => messageService.SendLinkMessage.call(messageService, Account, Body),
  };
  
  console.log("cmdssubscribe");
  
  // 使用 request/reply 模式处理消息
  natsConnection.subscribe('cmds', {
    callback: async (err, msg) => {
      if (err) {
        logger.error('Error in cmds subscription:', err);
        return;
      }
      
      try {
        const data = JSON.parse(msg.data);
        console.log("data:", data);
        const { Cmd, ReqId, Account, Body } = data;
        let jid = Account;
        
        if (Cmds[Cmd]) {
          const result = await Cmds[Cmd](jid, Body);
          console.log(`Command result:`, result);
          // 使用 respond 直接返回结果给调用者
          msg.respond(JSON.stringify(result));
        } else {
          console.log(`Command not found: ${Cmd}`);
          // 直接返回错误响应
          msg.respond(JSON.stringify({ Success: false, ErrMsg: "cmd not found" }));
        }
      } catch (error) {
        logger.error('Error processing message1:', error);
        // 直接返回错误响应
        try {
          msg.respond(JSON.stringify({ 
            Success: false, 
            ErrMsg: "Error processing message: " + error.message 
          }));
        } catch (respondError) {
          logger.error('Error sending error response:', respondError);
        }
      }
    }
  });
  
  logger.info('Successfully subscribed to cmds subject');
}

/**
 * Get NATS connection, create new one if it doesn't exist
 * @returns {Promise<Object>} - NATS connection
 */
async function getConnection() {
  console.log("getConnection");
  if (!natsConnection) {
    return await connectNats();
  }
  return natsConnection;
}

/**
 * Publish message to NATS
 * @param {string} subject - Subject to publish to
 * @param {Object} data - Data to publish
 * @returns {Promise<boolean>} - Success status
 */
async function publishMessage(subject, data) {
  try {
    const nc = await getConnection();
    if (!nc) {
      logger.error('Cannot publish message, no NATS connection');
      return false;
    }
    
    nc.publish(subject, JSON.stringify(data));
    return true;
  } catch (error) {
    logger.error('Failed to publish message to NATS:', error);
    return false;
  }
}

/**
 * Close NATS connection
 */
async function closeConnection() {
  if (natsConnection) {
    await natsConnection.drain();
    natsConnection = null;
    logger.info('NATS connection closed');
  }
}

module.exports = {
  connectNats,
  getConnection,
  publishMessage,
  closeConnection
}; 