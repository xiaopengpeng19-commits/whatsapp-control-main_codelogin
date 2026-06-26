const snowflake = require('../utils/snowflake');
const logger = require('../utils/logger');
const { getConnection, createConnection, GetAccountStateFromConnection, CloseConnection } = require('./baileys/connect');
const { formatPhoneNumber, isValidPhoneNumber, smartFormatPhoneNumber } = require('../utils/phoneFormatter');
const redisStorage = require('./redisStorage');


class AccountService {
  /**
   * 使用手机号码登录 WhatsApp
   * @param {Object} loginData - 登录数据
   * @param {string} loginData.phoneNumber - 手机号码
   * @param {string} loginData.proxy - 代理设置（可选）
   * @param {string} loginData.sessionId - 会话ID（可选）
   * @returns {Promise<Object>} - 登录结果，包含配对码
   */
  async loginWithPhoneNumber(loginData) {
    const { phoneNumber, proxy, sessionId } = loginData;

    try {
      // 验证手机号码
      if (!phoneNumber) {
        throw new Error('手机号码是必需的');
      }

      // // 格式化手机号码
      let formattedPhone;
      try {
        formattedPhone = smartFormatPhoneNumber(phoneNumber);
        logger.info(`FormatPhoneNumber: ${phoneNumber} -> ${formattedPhone}`);
      } catch (error) {
        throw new Error(`FormatPhoneNumber error: ${error.message}`);
      }
      // let formattedPhone = phoneNumber;

      // 创建账户对象
      const account = {
        id: snowflake.nextId().toString(),
        mark: `Phone: ${formattedPhone}`,
        account_status: 'unconnected',
        phoneNumber: formattedPhone,
        proxy: proxy || null,
        socket_status: 'disconnected',
        sessionId: sessionId || null,
      };

      logger.info(`create whatsapp connection for phone number: ${formattedPhone}`);

      // 创建登录成功后的回调函数
      let callbackfun=null;
      callbackfun=async()=>{
        try {
        await redisStorage.upsertAccount({
          phoneNumber: account.phoneNumber,
          id: account.id,
          mark: account.mark,
          proxy: account.proxy,
          socket_status: 'connected',
          account_status: 'normal',
          sessionId: sessionId
        });
        console.log('Account upserted to Redis:', account.phoneNumber);
      } catch (dbError) {
        console.error('Failed to save/update account to Redis:', dbError);
      }
      }

      // 使用配对码方式创建连接
      const result = await createConnection(account, callbackfun, 5, true);

      if (result.status === 500) {
        throw new Error('cant connect to whatsapp server');
      }

      if (result.status === 403) {
        return {
          success: true,
          accountId: account.id,
          phoneNumber: formattedPhone,
          pairingCode: result.qr,
          message: 'pairing code generated, please input this code in your app',
        };
      }

      if (result.status === 200) {
        return {
          success: true,
          accountId: account.id,
          phoneNumber: formattedPhone,
          message: 'login success',
          sock: result.sock
        };
      }

      throw new Error('unknown connection status');

    } catch (error) {
      logger.error(`login failed for phone number: ${phoneNumber}`, error);
      throw error;
    }
  }

  /**
   * Get all accounts
   */
  async getAllAccounts() {
    return await redisStorage.getAllAccounts();
  }

  /**
   * Create a new account
   */
  async createAccount(accountDic) {
    const { proxy } = accountDic;
    const account = {
      id: snowflake.nextId().toString(),
      mark: '',
      account_status: 'unconnected',
      phoneNumber: null,
      proxy: proxy,
      socket_status: 'disconnected'
    };

    await redisStorage.upsertAccount(account);
    return account;
  }

  async GetAccoutList(account,data){
    const accounts = await redisStorage.getAllAccounts();
    let result=[];
    for (let i = 0; i < accounts.length; i++) {
      let account = accounts[i];
      const accountState = await this.GetAccountState2(account);
      result.push({
        id: account.id,
        proxy: account.proxy,
        sessionId: account.sessionId,
        phoneNumber: account.phoneNumber,
        lastActive: account.lastActive,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        accountState: accountState
      });
    }
    return {
      Success:true,
      Accounts:result,
      ErrMsg:"",
    };
  }

  /**
   * Get an account by ID
   */
  async getAccount(id) {
    return await this.getAccountByPhoneNumberOrId(id);
  }

  /**
   * Connect an account
   * @param {string} id - Account ID
   * @param {string} proxy - Optional proxy URL in format protocol://host:port
   */
  async GetQRCode(accountin,data) {
    console.log("GetQRCode:",accountin,data);
    const { Proxy,SessionId } = data;
    // Create a new account if not exists
    let account = {
      id: snowflake.nextId().toString(),
      mark: '',
      account_status: 'unconnected',
      phoneNumber: null,
      proxy: Proxy,
      socket_status:'disconnected'
    };
    console.log("account:",account);
    let callbackfun=null;
    
      
      callbackfun=async()=>{
        try {
          await redisStorage.upsertAccount({
            phoneNumber: account.phoneNumber,
            id: account.id,
            mark: account.mark,
            proxy: account.proxy,
            socket_status: 'connected',
            account_status: 'normal',
            sessionId: SessionId
          });
          console.log('Account upserted to Redis:', account.phoneNumber);
        } catch (dbError) {
          console.error('Failed to save/update account to Redis:', dbError);
        }
      }
    
    
      console.log("callbackfuncgetQrCode",account)
      let result=await createConnection(account,callbackfun);
      console.log('resultgetQrCode:',result);
      
      if(result.status==500){
        return {
          Success:false,
          Data:"",
          ErrMsg: "cant connect to whatsapp",

        };
      }
      if(result.status==403){

       
        return {
          Success:true,
          Data:result.qr,
          ErrMsg:"",
        };
      }


  }
  async getQrCodeold(account,callbackurl) {
    console.log("callbackfuncgetQrCode",callbackurl)
    let result=await createConnection(account,callbackurl);
    console.log('resultgetQrCode:',result);
    
    if(result.status==500){
      return {
        status:500,
        data: "cant connect to whatsapp",

      };
    }
    if(result.status==403){
      return {
        status:403,
        qr: result.qr,
      };
    }


}
  async getPairCode(account,callbackurl) {
      console.log("callbackfuncgetPairCode",callbackurl)
      let result=await createConnection(account,callbackurl,5,true);
      console.log('resultgetPairCode:',result);
      
      if(result.status==500){
        return {
          status:500,
          data: "cant connect to whatsapp",

        };
      }
      if(result.status==403){
        return {
          status:403,
          qr: result.qr,
        };
      }


  }

  /**
   * Disconnect an account
   */
  async disconnectAccount(id) {
    const account = await this.getAccount(id);

    if (!account) {
      const error = new Error('Account not found');
      error.status = 404;
      throw error;
    }

    const updated = await redisStorage.updateAccount(account.id, {
      socket_status: 'disconnected'
    });

    return updated;
  }

 
  async getAccountByPhoneNumberOrId(phoneNumberOrId) {
    return await redisStorage.getAccountByPhoneOrId(phoneNumberOrId);
  }
  async GetAccountState(idorphone){
    try{
    
    let account=await this.getAccountByPhoneNumberOrId(idorphone);
    if(account){
      const accountState = await this.GetAccountState2(account);
      return {Success:true,State:accountState,ErrMsg:"",Account:account.phoneNumber};
     

    }else{
      return {Success:false,State:1,ErrMsg:"not found in db",Account:""};
    }
    
  }catch(error){
    return {Success:false,State:1,ErrMsg:error.message,Account:""};
  }
  }

  async GetAccountState2(account){
    const statusmap={
      '封禁':5,
      'expired':4,
      'normal':3,
      'unconnected':1,
      'logged_out':1,
      'logging':2,
      'banned':5,
    }
    try{
    const sockstatus=await GetAccountStateFromConnection(account.phoneNumber);
    if(sockstatus){
      console.log("sockstatus:",sockstatus);
      return statusmap[sockstatus.account_status] || 1;
    }
    console.log("account.account_status:",account.account_status);
      if(account.account_status=='封禁'){
        return 5;
      }else if(account.account_status=='expired'){
        return 4;
      }else if (account.account_status=='normal'){
        return 3;
      }else if (account.account_status=='unconnected'){
        return 1;
      }
      else{
       return 1;
      }
     
    
  }catch(error){
    return 1;
  }
  }
  async online(idorphone) {

    let connection=await getConnection(idorphone);
    if(!connection){
      return {'status':500,'data':"cant get account info"}
    }
    return {status:200,data:"online"};

  }
  async ContactsList(idorphone,body){
    let connection=await getConnection(idorphone);
    if(!connection){
      return {'Success':false,'Contacts':[],ErrMsg:"账号不存在"}
    }
    const Contacts=await redisStorage.getContactsByAccountId(idorphone);
    return {'Success':true,'Contacts':Contacts,ErrMsg:""}
  }
  
  async AddContacts(idorphone, body) {
    try {
      const { Phone, Name, Message } = body;
      
      if (!Phone) {
        return { Success: false, Phone: '', ErrMsg: "手机号码是必需的" };
      }

      // 获取 WhatsApp 连接
      let sock = await getConnection(idorphone);
      if (!sock) {
        return { Success: false, Phone: Phone, ErrMsg: "账号不存在或未连接" };
      }

      // 格式化手机号，确保是正确的 WhatsApp JID 格式
      const phoneNumber = Phone.replace(/[^\d]/g, ''); // 移除非数字字符
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

      console.log(`尝试添加联系人: ${phoneNumber} (${jid})`);

      // 1. 检查手机号是否在 WhatsApp 上
      const [onWhatsAppResult] = await sock.onWhatsApp(phoneNumber);
      
      if (!onWhatsAppResult || !onWhatsAppResult.exists) {
        return { 
          Success: false, 
          Phone: phoneNumber, 
          ErrMsg: "该手机号未注册 WhatsApp" 
        };
      }

      console.log(`手机号 ${phoneNumber} 已在 WhatsApp 上注册`);

      // 2. 发送欢迎消息（可选，建立聊天）
      if (Message) {
        try {
          await sock.sendMessage(jid, { text: Message });
          console.log(`欢迎消息已发送给 ${phoneNumber}`);
        } catch (msgError) {
          console.log(`发送消息失败，但联系人验证成功: ${msgError.message}`);
        }
      }

             // 3. 保存联系人信息到数据库
      //  const Chat = require('../models/Chat');
      //  const snowflake = require('../utils/snowflake');
      //  try {
      //    await Chat.upsert({
      //      id: snowflake.nextId(),
      //      peerPhone: phoneNumber,
      //      peerId: jid,
      //      peerName: Name || phoneNumber,
      //      accountPhone: idorphone,
      //      accountId: idorphone,
      //      isGroup: false,
      //      lastMessageTime: Date.now(),
      //      contactAdded: true // 标记为手动添加的联系人
      //    });
      //    console.log(`联系人 ${phoneNumber} 已保存到数据库`);
      //  } catch (dbError) {
      //    console.log(`保存联系人到数据库失败: ${dbError.message}`);
      //    // 不因为数据库错误而失败整个操作
      //  }

      // 4. 尝试获取联系人的个人资料信息
      // let profileInfo = null;
      // try {
      //   const profilePic = await sock.profilePictureUrl(jid, 'image').catch(() => null);
      //   const status = await sock.fetchStatus(jid).catch(() => null);
        
      //   profileInfo = {
      //     profilePicture: profilePic,
      //     status: status?.status || null,
      //     statusTimestamp: status?.setAt || null
      //   };
      //   console.log(`获取到联系人 ${phoneNumber} 的个人资料信息`);
      // } catch (profileError) {
      //   console.log(`获取个人资料失败: ${profileError.message}`);
      // }

      return {
        Success: true,
        Phone: phoneNumber,
        Jid: jid,
        Name: Name || phoneNumber,
        ProfileInfo: profileInfo,
        ErrMsg: ""
      };

         } catch (error) {
       console.error(`添加联系人失败: ${error.message}`);
       return {
         Success: false,
         Phone: body.Phone || '',
         ErrMsg: `添加联系人失败: ${error.message}`
       };
     }
   }

   // 批量添加联系人
   async AddContactsBatch(idorphone, body) {
     try {
       const { Contacts, Message } = body; // Contacts: [{Phone, Name}, ...]
       
       if (!Contacts || !Array.isArray(Contacts) || Contacts.length === 0) {
         return { Success: false, Results: [], ErrMsg: "联系人列表是必需的" };
       }

       // 获取 WhatsApp 连接
       let sock = await getConnection(idorphone);
       if (!sock) {
         return { Success: false, Results: [], ErrMsg: "账号不存在或未连接" };
       }

       const results = [];
       const snowflake = require('../utils/snowflake');

       // 批量验证手机号
       const phoneNumbers = Contacts.map(contact => 
         contact.Phone.replace(/[^\d]/g, '')
       );

       console.log(`开始批量验证 ${phoneNumbers.length} 个手机号...`);
       
       let onWhatsAppResults = [];
       try {
         onWhatsAppResults = await sock.onWhatsApp(...phoneNumbers);
       } catch (error) {
         console.error(`批量验证失败: ${error.message}`);
         return { Success: false, Results: [], ErrMsg: `批量验证失败: ${error.message}` };
       }

       // 处理每个联系人
       for (let i = 0; i < Contacts.length; i++) {
         const contact = Contacts[i];
         const phoneNumber = phoneNumbers[i];
         const jid = `${phoneNumber}@s.whatsapp.net`;
         
         try {
           // 检查是否在 WhatsApp 上
           const whatsappCheck = onWhatsAppResults.find(result => 
             result.jid === jid || result.jid.startsWith(phoneNumber)
           );

           if (!whatsappCheck || !whatsappCheck.exists) {
             results.push({
               Phone: phoneNumber,
               Name: contact.Name || phoneNumber,
               Success: false,
               ErrMsg: "该手机号未注册 WhatsApp"
             });
             continue;
           }

           // 发送欢迎消息（如果提供）
           if (Message) {
             try {
               await sock.sendMessage(jid, { text: Message });
               console.log(`欢迎消息已发送给 ${phoneNumber}`);
             } catch (msgError) {
               console.log(`发送消息失败: ${msgError.message}`);
             }
           }

           // 保存到 Redis
           try {
             await redisStorage.upsertChat({
               id: snowflake.nextId(),
               peerPhone: phoneNumber,
               peerId: jid,
               peerName: contact.Name || phoneNumber,
               accountPhone: idorphone,
               accountId: idorphone,
               isGroup: false,
               lastMessageTime: Date.now(),
               contactAdded: true
             });
           } catch (dbError) {
             console.log(`保存联系人 ${phoneNumber} 到 Redis 失败: ${dbError.message}`);
           }

           results.push({
             Phone: phoneNumber,
             Name: contact.Name || phoneNumber,
             Jid: jid,
             Success: true,
             ErrMsg: ""
           });

           console.log(`成功添加联系人: ${phoneNumber}`);

         } catch (error) {
           results.push({
             Phone: phoneNumber,
             Name: contact.Name || phoneNumber,
             Success: false,
             ErrMsg: error.message
           });
           console.error(`处理联系人 ${phoneNumber} 失败: ${error.message}`);
         }

         // 添加小延迟避免请求过快
         await new Promise(resolve => setTimeout(resolve, 100));
       }

       const successCount = results.filter(r => r.Success).length;
       const failureCount = results.length - successCount;

       return {
         Success: true,
         Results: results,
         Summary: {
           Total: results.length,
           Success: successCount,
           Failed: failureCount
         },
         ErrMsg: ""
       };

     } catch (error) {
       console.error(`批量添加联系人失败: ${error.message}`);
       return {
         Success: false,
         Results: [],
         ErrMsg: `批量添加联系人失败: ${error.message}`
       };
     }
   }

  async GetPhoneCode(idorphone){
  //   let account=await this.getAccountByPhoneNumberOrId(idorphone);
  //   if(account){
  //     return {Success:true,Code:account.phoneCode,ErrMsg:"",Account:account.phoneNumber};
  //   }else{
  //     return {Success:false,State:1,ErrMsg:"not found in db",Account:""};
  //   }
  // }
  }
  async Online(idorphone){
    try{
     const sockstatus=await getConnection(idorphone);
     if(sockstatus){
      return {Success:true,ErrMsg:""};
     }
     else{
      return {Success:false,ErrMsg:"connection failed"};
     }
  }catch(error){
    return {Success:false,ErrMsg:error.message};
  }
  }
  async Offline(idorphone){
    try{
      await CloseConnection(idorphone);
      return {Success:true,ErrMsg:""};
    }catch(error){
      return {Success:false,ErrMsg:error.message};
    }
  }
  async DeleteAccount(id) {
    const account = await this.getAccountByPhoneNumberOrId(id);

    if (!account) {
      return {Success:false,ErrMsg:"account not found"};
    }

    await redisStorage.deleteAccount(account.id);
    return {Success:true,ErrMsg:""};
  }
  async BindProxy(idorphone,data){
    const {Proxy}=data;
    const account = await this.getAccount(idorphone);

    if (!account) {
      return {Success:false,ErrMsg:"account not found"};
    }
    if(!Proxy){
      await CloseConnection(idorphone);
      return {Success:false,ErrMsg:"proxy is required"};
    }
    await redisStorage.updateAccount(account.id, { proxy: Proxy });
    await CloseConnection(idorphone);

    return {Success:true,ErrMsg:""};
  }
  async Delete(idorphone){
    try{
      try{
        await CloseConnection(idorphone);
      }catch(error){
        
      }
      
      const account = await this.getAccount(idorphone);
      if(account){
        await redisStorage.deleteAccount(account.id);
      }
      return {Success:true,ErrMsg:""};
    }catch(error){
      return {Success:false,ErrMsg:error.message};
    }
  }
  //todo query
  async Query(idorphone,data){
    try{
      const {Phones}=data;
      const sock=await getConnection(idorphone);
      
        const contacts=await sock.onWhatsApp(...phones)
        let results=contacts.map(contact=>{
          return contact.jid.split('@')[0]
        })
      return {Success:true,ErrMsg:"",'Phones':results};
    }catch(error){
      return {Success:false,ErrMsg:error.message};
    }
  }
}

module.exports = new AccountService();