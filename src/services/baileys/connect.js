const { default: makeWASocket,fetchLatestBaileysVersion, useMultiFileAuthState, DisconnectReason,getContentType,Browsers,makeCacheableSignalKeyStore } = require('baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

const nats = require('../../config/nats');
const Account = require('../../models/Account');
const Chat = require('../../models/Chat');
const Contact = require('../../models/Contact');
const {NodeCache} = require('@cacheable/node-cache');
const { SocksProxyAgent }=require('socks-proxy-agent');
const snowflake = require('../../utils/snowflake');
// Map to store active WhatsApp connections
const connections = new Map();
const groupCache = new NodeCache({stdTTL: 5 * 60, useClones: false})
/**
 * Create a WhatsApp connection
 * @param {string} accountId - The unique account ID
 * @returns {Promise<Object>} - Socket connection object
 */
async function createConnection(account,callbackfun=null,retry_n=5,paircode=false) {
  const accountId=account.id;
  try {
    let timeoutId=null;
    let sessionDir=null;
    try{
      sessionDir = path.join( './storage/sessions', account.id+'');
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
    }catch(error){
      console.log("createConnection error",accountId,error);
    }
    // const { version, isLatest } = await fetchLatestBaileysVersion()

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    let proxyAgent;
    if(account.proxy){
      proxyAgent = new SocksProxyAgent(account.proxy);
    }
    let successresolve=null;
    let rejectresolve=null;
    let promise=null;
    const sock = makeWASocket({
      // logger,
      // version, //目前没具体作用
      printQRInTerminal: false,
      // browser: Browsers.macOS("Google Chrome"),//错误示范
      // browser: ["Ubuntu","Chrome","22.04.4"], //风控点 如果风控打开 logger 注释 查看发送配对码之后的提示 
      auth: state,
      agent: proxyAgent,
      // syncFullHistory: true,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
      retryRequestDelayMs:1000,
    });
    sock.account_status="logging";
    promise=new Promise(async(resolve,reject)=>{
      successresolve=resolve;
      rejectresolve=reject;
      timeoutId = global.setTimeout(() => {
        logger.error(`[Timeout] WhatsApp 连接超时，accountId: ${accountId}, phone: ${account.phoneNumber}, paircode: ${paircode}`);
        closeConnection(accountId);
        reject(new Error('Connection timeout'));
      }, 1000*12);
      timeoutId.unref();
    }).finally(()=>{
      if(timeoutId){
        clearTimeout(timeoutId);
      }
    });
    sock.lastActiveTime=new Date();
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messaging-history.set',async(event)=>{
      console.log('on messaging-history.set');
      
      const{
        messages,
        groups,
        chats,
        contacts,
        syncType,
        isLatest,
      }=event;
      
      console.log('messages:',messages);
     
      console.log('syncType:',syncType);
      console.log('isLatest:',isLatest);
      console.log('chats:',chats);
      console.log('contacts:',contacts);
      console.log('event:',Object.keys(event));
      for(const chat of chats){
       try{
        console.log('chat:',chat);
        await Chat.upsert({
          id:snowflake.nextId(),
          peerPhone:chat.id.split('@')[0],
          peerId:chat.id,
          peerName:'',
          accountPhone:account.phoneNumber,
          accountId:accountId,
          isGroup:chat.id.includes('g.us'),
          lastMessageTime:chat.lastMessageRecvTimestamp,
        });
       }catch(error){
        console.log('error:',error);
       }
       
      }

      for(const contact of contacts){
        try{
          console.log('contact:',contact);
          await Chat.upsert({
            id:snowflake.nextId(),
            peerPhone:contact.id.split('@')[0],
            peerId:contact.id,
            peerName:contact.name,
            accountId:accountId,
            accountPhone:account.phoneNumber,
            isGroup:contact.id.includes('g.us'),
          });
        }catch(error){
          console.log('error:',error);
        }
      }

    });
    sock.ev.on('groups.update', async ([event]) => {
      const metadata = await sock.groupMetadata(event.id)
      groupCache.set(event.id, metadata)
    })
    sock.ev.on('group-participants.update', async (event) => {
    const metadata = await sock.groupMetadata(event.id)
    groupCache.set(event.id, metadata)
    })
    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      // --- 区分登录方式 ---
      if (paircode) {
        // 只在 qr 事件触发时请求配对码
        if (qr && !sock.pairingCodeRequested) {
          sock.pairingCodeRequested = true;
          try {
            
            // logger.info(` ${account.phoneNumber} qr code  ${qr}`);
            const code = await sock.requestPairingCode(account.phoneNumber);
            logger.info(`[Pairing] 配对码生成成功: ${code}`);
            successresolve({status:403,qr:code});
            await Account.update(
              { status: 'connecting'},//, account_status: 'connecting' },
              { where: { id: accountId } }
            );
          } catch (err) {
            logger.error(`[Pairing] requestPairingCode 异常:`, err);
            rejectresolve && rejectresolve(err);
          }
        }
      } else {
        // 二维码登录
        if (qr) {
          try {
            successresolve({status:403,qr:qr});
            logger.info(`QR code generated for account ${accountId}`);
            await Account.update(
              { status: 'connecting' },
              { where: { id: accountId } }
            );
          } catch (error) {
            logger.error(`Failed to store QR code for account ${accountId}:`, error);
          }
        }
      }
      // --- 其余连接状态处理不变 ---
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof  Boom) && lastDisconnect.error?.output?.statusCode!==403 &&
            (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut && lastDisconnect.error.message!='QR refs attempts ended');
            retry_n--;
        logger.info(`Connection closed for ${accountId} due to ${lastDisconnect.error},${lastDisconnect.error?.output?.statusCode}, reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) {
          if( retry_n>0){
            await new Promise(resolve => global.setTimeout(resolve, 1000));
            return await createConnection(account,callbackfun,retry_n,paircode);
          }else{
            if(rejectresolve){
              console.log('call rejectresolve');
              sock.account_status="expired";
              await Account.update(
                { account_status: 'expired' },
                { where: { id: accountId } }
            );
              rejectresolve(new Error('Connection timeout'));
            }
          }
        } else {
          if(lastDisconnect.error?.output?.statusCode==403){
            sock.account_status="banned";
            await Account.update(
              { account_status: 'banned' },
              { where: { id: accountId } }
            );
            const sessionDir = `./storage/sessions/${accountId}`;
          }else{
            sock.account_status="expired";
            await Account.update(
              { account_status: 'expired' },
              { where: { id: accountId } }
          );
          }
          const sessionDir = `./storage/sessions/${accountId}`;
          try {
            const files = fs.readdirSync(sessionDir);
            if (files.length === 0) {
              fs.rmdirSync(sessionDir);
              logger.info(`Removed empty session directory for account ${accountId}`);
            }
          } catch (error) {
            logger.error(`Error checking/removing session directory for ${accountId}:`, error);
          }
          connections.delete(accountId);
        }
      } else if (connection === 'open') {
        console.log(`WhatsApp connection established for ${accountId},callbackfun:${callbackfun}`);
        const phoneNumber = sock.user?.id?.split(':')[0];
        account.phoneNumber=phoneNumber;
        account.account_status='normal';
        sock.account_status="normal";
          await Account.update(
            {
              lastActive: new Date(),
              account_status: 'normal',
              phoneNumber: phoneNumber || ''
            },
            { where: { id: accountId } }
          );
          console.log('connection open');
          if(successresolve){
            console.log('call successresolve');
            successresolve({status:200,sock:sock});
          }
        if(callbackfun){
          console.log("call callbackfun")
          console.log("caLL;",callbackfun)
          await callbackfun();
          callbackfun=null;
        }
      }
    });
   // 添加聊天列表保存逻辑
   sock.ev.on('chats.upsert', async (chats) => {
    console.log('got chats',chats)
   
    for (const chat of chats){
      try{
        console.log('chat:',chat);
        await Chat.upsert({
          id:snowflake.nextId(),
          peerPhone:chat.id.split('@')[0],
          peerId:chat.id,
          peerName:'',
          accountPhone:account.phoneNumber,
          accountId:accountId,
          isGroup:chat.id.includes('g.us'),
          lastMessageTime:chat.lastMessageRecvTimestamp,
        });
       }catch(error){
        console.log('error:',error);
       }
    }
  });
    // Handle message receipt updates (已读回执) - 方式1
    sock.ev.on('message-receipt.update', async (updates) => {
      console.log('got message receipts update', updates);
      await handleReceiptUpdates(updates);
    });

    // Handle message receipt updates (已读回执) - 方式2 (兼容不同版本)
    sock.ev.on('messages.receipt.update', async (updates) => {
      console.log('got messages receipt update', updates);
      await handleReceiptUpdates(updates);
    });

    // 统一处理回执更新的函数
    const handleReceiptUpdates = async (updates) => {
      for (const update of updates) {
        try {
          const receiptData = {
            accountId,
            accountPhone: account.phoneNumber,
            messageId: update.key.id,
            remoteJid: update.key.remoteJid,
            fromMe: update.key.fromMe,
            receipt: update.receipt,
            receiptTimestamp: update.receiptTimestamp,
            participant: update.key.participant,
           // type: 'receipt_update',
            MessageType:"msg_status_update"
          };
          
          // 发布回执更新到 NATS
          await nats.publishMessage(`msgs`, receiptData);
          
          // 根据回执类型记录日志和处理逻辑
          const receiptType = update.receipt;
          switch (receiptType) {
            case 'read':
              console.log(`✓✓ Message ${update.key.id} was READ by ${update.key.remoteJid}`);
              break;
            case 'read-self':
              console.log(`✓✓ Message ${update.key.id} was READ by sender (read-self)`);
              break;
            case 'played':
              console.log(`🎵 Voice message ${update.key.id} was PLAYED by ${update.key.remoteJid}`);
              break;
            case 'delivered':
              console.log(`✓ Message ${update.key.id} was DELIVERED to ${update.key.remoteJid}`);
              break;
            case 'server-ack':
              console.log(`📤 Message ${update.key.id} received by server`);
              break;
            default:
              console.log(`📋 Message ${update.key.id} receipt: ${receiptType}`);
          }
          
          logger.info(`Receipt update published to NATS: ${update.key.id} - ${receiptType}`);
        } catch (error) {
          logger.error(`Error processing receipt update: ${error}`);
        }
      }
    };

    // Handle messages
    sock.ev.on('messages.upsert', async (m) => {
      console.log('got messages', m.messages,m.type)
      if (m.type === 'notify' || m.type==='append') {
        // Update last active time when a message is received
       
        
        sock.lastActiveTime = new Date();
        for (const msg of m.messages){
          try{
            // 获取消息类型
            const messageType = getContentType(msg);
            console.log(`Message type: ${messageType}`);
            
            // 处理特殊命令消息
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (text && (text === "requestPlaceholder" || text === "onDemandHistSync")) {
              if (text === "requestPlaceholder") {
                const messageId = await sock.requestPlaceholderResend(msg.key);
                console.log('requested placeholder resync, id=', messageId);
              } else {
                const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
                console.log('requested on-demand sync, id=', messageId);
              }
              continue;
            }

            // 根据消息类型设置MessageType和content
            let content = '';
            let msgType = 'msg_unknown';
            let mediaInfo = null;

            switch (messageType) {
              case 'conversation':
              case 'extendedTextMessage':
                content = text || '';
                msgType = 'msg_text';
                break;
                
              case 'imageMessage':
                content = msg.message.imageMessage?.caption || '';
                msgType = 'msg_image';
                mediaInfo = {
                  mimetype: msg.message.imageMessage?.mimetype,
                  url: msg.message.imageMessage?.url,
                  fileLength: msg.message.imageMessage?.fileLength,
                  height: msg.message.imageMessage?.height,
                  width: msg.message.imageMessage?.width
                };
                // 下载图片
                (async () => {
                  try {
                    const stream = await downloadMediaMessage(msg, 'stream', {}, {
                      logger,
                      reuploadRequest: sock.updateMediaMessage
                    });
                    const writeStream = createWriteStream(`./imgdata/${msg.key.id}.jpeg`);
                    stream.pipe(writeStream);
                  } catch (error) {
                    logger.error('Error downloading image:', error);
                  }
                })();
                break;

              case 'videoMessage':
                content = msg.message.videoMessage?.caption || '';
                msgType = 'msg_video';
                mediaInfo = {
                  mimetype: msg.message.videoMessage?.mimetype,
                  url: msg.message.videoMessage?.url,
                  fileLength: msg.message.videoMessage?.fileLength,
                  seconds: msg.message.videoMessage?.seconds,
                  height: msg.message.videoMessage?.height,
                  width: msg.message.videoMessage?.width
                };
                break;

              case 'audioMessage':
                content = '';
                msgType = msg.message.audioMessage?.ptt ? 'msg_voice' : 'msg_audio';
                mediaInfo = {
                  mimetype: msg.message.audioMessage?.mimetype,
                  url: msg.message.audioMessage?.url,
                  fileLength: msg.message.audioMessage?.fileLength,
                  seconds: msg.message.audioMessage?.seconds,
                  ptt: msg.message.audioMessage?.ptt // 是否为语音消息
                };
                break;

              case 'documentMessage':
                content = msg.message.documentMessage?.caption || '';
                msgType = 'msg_document';
                mediaInfo = {
                  mimetype: msg.message.documentMessage?.mimetype,
                  url: msg.message.documentMessage?.url,
                  fileLength: msg.message.documentMessage?.fileLength,
                  fileName: msg.message.documentMessage?.fileName,
                  title: msg.message.documentMessage?.title
                };
                break;

              case 'stickerMessage':
                content = '';
                msgType = 'msg_sticker';
                mediaInfo = {
                  mimetype: msg.message.stickerMessage?.mimetype,
                  url: msg.message.stickerMessage?.url,
                  fileLength: msg.message.stickerMessage?.fileLength,
                  height: msg.message.stickerMessage?.height,
                  width: msg.message.stickerMessage?.width
                };
                break;

              case 'locationMessage':
                content = msg.message.locationMessage?.name || '';
                msgType = 'msg_location';
                mediaInfo = {
                  latitude: msg.message.locationMessage?.degreesLatitude,
                  longitude: msg.message.locationMessage?.degreesLongitude,
                  name: msg.message.locationMessage?.name,
                  address: msg.message.locationMessage?.address
                };
                break;

              case 'contactMessage':
                content = msg.message.contactMessage?.displayName || '';
                msgType = 'msg_contact';
                mediaInfo = {
                  displayName: msg.message.contactMessage?.displayName,
                  vcard: msg.message.contactMessage?.vcard
                };
                break;

              default:
                content = JSON.stringify(msg.message);
                msgType = 'msg_other';
                console.log(`Unhandled message type: ${messageType}`);
            }

            // 构建消息数据
            const messageData = {
              accountId,
              accountPhone: account.phoneNumber,
              messageId: msg.key.id,
              remoteJid: msg.key.remoteJid,
              fromMe: msg.key.fromMe,
              timestamp: msg.messageTimestamp,
              pushName: msg.pushName,
              message: msg.message,
              participant: msg.key.participant,
              content: content,
              MessageType: msgType,
              mediaInfo: mediaInfo,
              originalMessageType: messageType
            };

            // 发布消息到 NATS
            await nats.publishMessage(`msgs`, messageData);
            // logger.info(`${msgType} message published to NATS: ${msg.key.id}`);

            // 标记消息为已读（如果不是自己发送的消息）
            if(!msg.key.fromMe ) {// && !isJidNewsletter(msg.key?.remoteJid)
              await sock.readMessages([msg.key])
            }
          } catch(error) {
            logger.error(`Error processing message3: ${error}`);
          }
        }
        // Process incoming messages
        // This would be implemented in your message service
      }
    });

    // Store connection in map
    
    try{
      let result=await promise;
      console.log("result:",result);
      connections.set(accountId, result.sock);
      return result;
    }catch(error){
      logger.error(`Error creating WhatsApp connection for ${accountId} return null:`, error);
      return {status:500,sock:null};
    }
    
  } catch (error) {
    logger.error(`Error creating WhatsApp connection for ${accountId}:`, error);
    return {status:500,sock:null};
  }
}

async function GetAccountStateFromConnection(idorphone){
  const sockstatus=connections.get(idorphone);
  return sockstatus;
}
async function getConnection(idorphone,callbackfun=null) {
  if (connections.has(idorphone)) {
    return connections.get(idorphone);
  }

  // Use deferred require to avoid circular dependency
  const accountService = require('../account');

  let account = await accountService.getAccountByPhoneNumberOrId(idorphone);

  if (!account) {
    return null;
  }
  if (connections.has(account.id)) {
    return connections.get(account.id);
  }

  const {sock}=await createConnection(account,callbackfun);
  return sock;
}
async function fetchMessageHistory(idorphone,chatId,limit){
  const sock=await getConnection(idorphone);
  if(!sock){
    return null;
  }
  //const msg = await getOldestMessageInChat(jid)
  let tmp=await sock.fetchMessageHistory(chatId,limit);
  console.log('tmp:',tmp);
  return tmp;
}

async function intervalStopIdelConnection(){
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  logger.info(`Checking for idle connections older than ${oneHourAgo.toISOString()}`);

  // Iterate through all connections
  for (const [accountId, sock] of connections.entries()) {
    // Check if the connection has lastActiveTime property and if it's older than 1 hour
    if (sock.lastActiveTime && sock.lastActiveTime < oneHourAgo) {
      logger.info(`Closing idle connection for account ${accountId}. Last active: ${sock.lastActiveTime.toISOString()}`);
      await closeConnection(accountId);
    }
  }
}

/**
 * Close a WhatsApp connection
 * @param {string} accountId - The unique account ID
 */
async function closeConnection(accountId) {
  if (connections.has(accountId)) {
    try{
      const sock = connections.get(accountId);
      sock.end();
      connections.delete(accountId);
    }catch(error){
      logger.error(`Error closing connection for ${accountId}:`, error);
    }



    logger.info(`Connection closed for ${accountId}`);
  }
}

async function CloseConnection(idorphone){
  if (connections.has(idorphone)) {
    const sock = connections.get(idorphone);
    sock.end();
    connections.delete(idorphone);
  }
}

/**
 * Get all active connections
 * @returns {Map} - Map of all active connections
 */
function getAllConnections() {
  return connections;
}

module.exports = {
  createConnection,
  getConnection,
  closeConnection,
  CloseConnection,
  getAllConnections,
  intervalStopIdelConnection,
  GetAccountStateFromConnection
};