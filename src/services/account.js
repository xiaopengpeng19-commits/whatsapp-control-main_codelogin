// account.js - 修改所有方法返回统一格式
const snowflake = require('../utils/snowflake');
const { auth } = require('../utils/logger'); const logger = auth;
const { getConnection, createConnection, GetAccountStateFromConnection, CloseConnection } = require('./baileys/connect');
const { formatPhoneNumber, isValidPhoneNumber, smartFormatPhoneNumber } = require('../utils/phoneFormatter');
const redisStorage = require('./redisStorage');

class AccountService {
  /**
   * 使用手机号码登录 WhatsApp
   */
  async loginWithPhoneNumber(loginData) {
    const { phoneNumber, proxy, sessionId } = loginData;

    try {
      if (!phoneNumber) {
        throw new Error('手机号码是必需的');
      }

      let formattedPhone;
      try {
        formattedPhone = smartFormatPhoneNumber(phoneNumber);
        logger.info(`FormatPhoneNumber: ${phoneNumber} -> ${formattedPhone}`);
      } catch (error) {
        throw new Error(`FormatPhoneNumber error: ${error.message}`);
      }

      const account = {
        id: snowflake.nextId().toString(),
        mark: `Phone: ${formattedPhone}`,
        account_status: 'unconnected',
        phoneNumber: formattedPhone,
        proxy: proxy || null,
        sessionId: sessionId || null,
      };

      logger.info(`create whatsapp connection for phone number: ${formattedPhone}`);

      let callbackfun = null;
      callbackfun = async () => {
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
          logger.info('Account upserted to Redis:', account.phoneNumber);
        } catch (dbError) {
          logger.error('Failed to save/update account to Redis:', dbError);
        }
      }

      const result = await createConnection(account, callbackfun, 5, true);

      if (result.status === 500) {
        throw new Error('cant connect to whatsapp server');
      }

      if (result.status === 403) {
        return {
          code: 200,
          message: "pairing code generated",
          data: {
            success: true,
            accountId: account.id,
            phoneNumber: formattedPhone,
            pairingCode: result.qr,
            message: 'pairing code generated, please input this code in your app'
          }
        };
      }

      if (result.status === 200) {
        return {
          code: 200,
          message: "login success",
          data: {
            success: true,
            accountId: account.id,
            phoneNumber: formattedPhone,
            sock: result.sock
          }
        };
      }

      throw new Error('unknown connection status');
    } catch (error) {
      logger.error(`login failed for phone number: ${phoneNumber}`, error);
      return { code: 500, message: error.message, data: null };
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

  async GetAccoutList(account, data) {
    try {
      const accounts = await redisStorage.getAllAccounts();
      let result = [];
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
        code: 200,
        message: "success",
        data: {
          accounts: result
        }
      };
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Get an account by ID
   */
  async getAccount(id) {
    return await this.getAccountByPhoneNumberOrId(id);
  }

  /**
   * Connect an account - Get QR Code
   */
  async GetQRCode(accountin, data) {
    logger.info("GetQRCode:", accountin, data);
    const { proxy, SessionId } = data;
    let account = {
      id: snowflake.nextId().toString(),
      mark: '',
      account_status: 'unconnected',
      phoneNumber: null,
      proxy: proxy,
      socket_status: 'disconnected'
    };
    logger.info("account:", account);
    let callbackfun = null;

    callbackfun = async () => {
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
        logger.info('Account upserted to Redis:', account.phoneNumber);
      } catch (dbError) {
        logger.error('Failed to save/update account to Redis:', dbError);
      }
    }

    logger.info("callbackfuncgetQrCode", account);
    let result = await createConnection(account, callbackfun);
    logger.info('resultgetQrCode:', result);

    if (result.status == 'failed') {
      return {
        code: 500,
        message: "cant connect to whatsapp",
        data: null
      };
    }
    if (result.status == 'waiting_qr') {
      return {
        code: 200,
        message: "qr code generated",
        data: {
          qrCode: result.qr
        }
      };
    }
    return {
      code: 500,
      message: `unknown status: ${result.status}`,
      data: null
    };
  }

  async getPairCode(account, callbackurl) {
    logger.info("callbackfuncgetPairCode", callbackurl);
    let result = await createConnection(account, callbackurl, 5, true);
    logger.info('resultgetPairCode:', result);

    if (result.status == 500) {
      return {
        status: 500,
        data: "cant connect to whatsapp",
      };
    }
    if (result.status == 403) {
      return {
        status: 403,
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
      return { code: 404, message: 'Account not found', data: null };
    }
    const updated = await redisStorage.updateAccount(account.id, {
      socket_status: 'disconnected'
    });
    return { code: 200, message: "success", data: updated };
  }

  async getAccountByPhoneNumberOrId(phoneNumberOrId) {
    return await redisStorage.getAccountByPhoneOrId(phoneNumberOrId);
  }

  async GetAccountState(idorphone) {
    try {
      let account = await this.getAccountByPhoneNumberOrId(idorphone);
      if (account) {
        const accountState = await this.GetAccountState2(account);
        return {
          code: 200,
          message: "success",
          data: {
            state: accountState,
            account: account.phoneNumber
          }
        };
      } else {
        return {
          code: 404,
          message: "not found in db",
          data: null
        };
      }
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }

  async GetAccountState2(account) {
    const statusmap = {
      'banned': 5,
      'expired': 4,
      'normal': 3,
      'unconnected': 1,
      'logged_out': 1,
      'logging': 2,
      'banned': 5,
    }
    try {
      const sockstatus = await GetAccountStateFromConnection(account.phoneNumber);
      if (sockstatus) {
        logger.info("sockstatus:", sockstatus);
        return statusmap[sockstatus.account_status] || 1;
      }
      logger.info("account.account_status:", account.account_status);
      if (account.account_status == 'banned') {
        return 5;
      } else if (account.account_status == 'expired') {
        return 4;
      } else if (account.account_status == 'normal') {
        return 3;
      } else if (account.account_status == 'unconnected') {
        return 1;
      } else {
        return 1;
      }
    } catch (error) {
      return 1;
    }
  }

  // services/account.js

async online(idorphone, proxyOverride = null) {
  logger.info(idorphone, proxyOverride);
  try {
    // ========== 先获取账号信息 ==========
    const account = await this.getAccountByPhoneNumberOrId(idorphone);
    if (!account) {
      return { code: 404, message: "账号不存在", data: null };
    }

    // ========== 使用传入的 proxy，如果没有则用 Redis 中的 ==========
    const useProxy = proxyOverride || account.proxy || null;
    
    // 如果 proxy 有变化，更新到 Redis
    if (useProxy && useProxy !== account.proxy) {
      await redisStorage.updateAccount(account.id, { proxy: useProxy });
      logger.info(`[${idorphone}] 更新 proxy: ${useProxy}`);
    }

    // ========== 创建连接（传入 proxy） ==========
    const connection = await getConnection(idorphone, null, useProxy);
    if (connection) {
      return { code: 200, message: "online", data: null };
    } else {
      return { code: 500, message: "connection failed", data: null };
    }
  } catch (error) {
    logger.error(`[${idorphone}] 上线失败:`, error);
    return { code: 500, message: error.message, data: null };
  }
}

async ContactsList(idorphone, body) {
  try {
    // 不需要获取 connection，直接从 Redis 读取
    const contacts = await redisStorage.getContactsByAccountId(idorphone);
    return {
      code: 200,
      message: "success",
      data: { contacts }
    };
  } catch (error) {
    return { code: 500, message: error.message, data: null };
  }
}

  // services/account.js

// ========== AddContacts - 只添加联系人 ==========
async AddContacts(idorphone, body) {
  try {
    const { Phone, Name } = body;

    if (!Phone) {
      return { code: 400, message: "手机号码是必需的", data: null };
    }

    // 获取连接
    let sock = await getConnection(idorphone);
    if (!sock) {
      return { code: 500, message: "账号不存在或未连接", data: null };
    }

    // 格式化号码
    const phoneNumber = Phone.replace(/[^\d]/g, '');
    const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

    // 验证是否已注册 WhatsApp
    const [onWhatsAppResult] = await sock.onWhatsApp(phoneNumber);
    if (!onWhatsAppResult || !onWhatsAppResult.exists) {
      return {
        code: 400,
        message: "该手机号未注册 WhatsApp",
        data: { phone: phoneNumber }
      };
    }

    // ========== 添加到通讯录 ==========
    await sock.addOrEditContact(jid, {
      name: Name || phoneNumber,
      notify: Name || phoneNumber,
    });

    // 保存到 Redis
    await redisStorage.upsertChat({
      id: snowflake.nextId(),
      peerPhone: phoneNumber,
      peerId: jid,
      peerName: Name || phoneNumber,
      accountPhone: idorphone,
      accountId: idorphone,
      isGroup: false,
      contactAdded: true,
      lastMessageTime: Date.now(),
    });

    return {
      code: 200,
      message: "success",
      data: {
        phone: phoneNumber,
        jid: jid,
        name: Name || phoneNumber
      }
    };
  } catch (error) {
    logger.error(`添加联系人失败: ${error.message}`);
    return { code: 500, message: error.message, data: null };
  }
}

// ========== AddContactsBatch - 批量添加联系人 ==========
async AddContactsBatch(idorphone, body) {
  try {
    const { Contacts } = body;

    if (!Contacts || !Array.isArray(Contacts) || Contacts.length === 0) {
      return { code: 400, message: "联系人列表是必需的", data: null };
    }

    // 获取连接
    let sock = await getConnection(idorphone);
    if (!sock) {
      return { code: 500, message: "账号不存在或未连接", data: null };
    }

    // 提取所有手机号
    const phoneNumbers = Contacts.map(contact =>
      contact.Phone.replace(/[^\d]/g, '')
    );

    // 批量验证
    let onWhatsAppResults = [];
    try {
      onWhatsAppResults = await sock.onWhatsApp(...phoneNumbers);
    } catch (error) {
      logger.error(`批量验证失败: ${error.message}`);
      return { code: 500, message: `批量验证失败: ${error.message}`, data: null };
    }

    const results = [];

    for (let i = 0; i < Contacts.length; i++) {
      const contact = Contacts[i];
      const phoneNumber = phoneNumbers[i];
      const jid = `${phoneNumber}@s.whatsapp.net`;
      const displayName = contact.Name || phoneNumber;

      try {
        // 检查是否已注册
        const whatsappCheck = onWhatsAppResults.find(result =>
          result.jid === jid || result.jid.startsWith(phoneNumber)
        );

        if (!whatsappCheck || !whatsappCheck.exists) {
          results.push({
            phone: phoneNumber,
            name: displayName,
            success: false,
            errMsg: "该手机号未注册 WhatsApp"
          });
          continue;
        }

        // ========== 添加到通讯录 ==========
        await sock.addOrEditContact(jid, {
          name: displayName,
          notify: displayName,
        });

        // 保存到 Redis
        await redisStorage.upsertChat({
          id: snowflake.nextId(),
          peerPhone: phoneNumber,
          peerId: jid,
          peerName: displayName,
          accountPhone: idorphone,
          accountId: idorphone,
          isGroup: false,
          contactAdded: true,
          lastMessageTime: Date.now(),
        });

        results.push({
          phone: phoneNumber,
          name: displayName,
          jid: jid,
          success: true,
          errMsg: ""
        });

        logger.info(`成功添加联系人: ${phoneNumber} (${displayName})`);

      } catch (error) {
        logger.error(`添加联系人 ${phoneNumber} 失败: ${error.message}`);
        results.push({
          phone: phoneNumber,
          name: displayName,
          success: false,
          errMsg: error.message
        });
      }

      // 限速
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    return {
      code: 200,
      message: "success",
      data: {
        results: results,
        summary: {
          total: results.length,
          success: successCount,
          failed: failureCount
        }
      }
    };
  } catch (error) {
    logger.error(`批量添加联系人失败: ${error.message}`);
    return { code: 500, message: error.message, data: null };
  }
}

async GetPhoneCode(idorphone) {
  // 暂时返回空
  return { code: 200, message: "success", data: null };
}

  // services/account.js

async Online(idorphone, body = {}) {
  try {
    // ========== 从 body 中获取 proxy ==========
    const proxyOverride = body?.proxy || null;
    
    // 获取账号信息
    const account = await this.getAccountByPhoneNumberOrId(idorphone);
    if (!account) {
      return { code: 404, message: "账号不存在", data: null };
    }

    // 使用传入的 proxy，如果没有则用 Redis 中的
    const useProxy = proxyOverride || account.proxy || null;
    
    // 如果 proxy 有变化，更新到 Redis
    if (useProxy && useProxy !== account.proxy) {
      await redisStorage.updateAccount(account.id, { proxy: useProxy });
      logger.info(`[${idorphone}] 更新 proxy: ${useProxy}`);
    }

    // 创建连接（传入 proxy）
    const connection = await getConnection(idorphone, null, useProxy);
    if (connection) {
      return { code: 200, message: "online", data: null };
    } else {
      return { code: 500, message: "connection failed", data: null };
    }
  } catch (error) {
    logger.error(`[${idorphone}] 上线失败:`, error);
    return { code: 500, message: error.message, data: null };
  }
}

  async Offline(idorphone) {
    try {
      await CloseConnection(idorphone);
      return { code: 200, message: "offline", data: null };
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }

  async DeleteAccount(id) {
    const account = await this.getAccountByPhoneNumberOrId(id);
    if (!account) {
      return { code: 404, message: "account not found", data: null };
    }
    await redisStorage.deleteAccount(account.id);
    return { code: 200, message: "success", data: null };
  }

  async BindProxy(idorphone, data) {
    const { Proxy } = data;
    const account = await this.getAccount(idorphone);
    if (!account) {
      return { code: 404, message: "account not found", data: null };
    }
    if (!Proxy) {
      await CloseConnection(idorphone);
      return { code: 400, message: "proxy is required", data: null };
    }
    await redisStorage.updateAccount(account.id, { proxy: Proxy });
    await CloseConnection(idorphone);
    return { code: 200, message: "success", data: null };
  }

  async Delete(idorphone) {
    try {
      try {
        await CloseConnection(idorphone);
      } catch (error) { }

      const account = await this.getAccount(idorphone);
      if (account) {
        await redisStorage.deleteAccount(account.id);
      }
      return { code: 200, message: "success", data: null };
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }

  async Query(idorphone, data) {
    try {
      const { Phones } = data;
      const sock = await getConnection(idorphone);
      const contacts = await sock.onWhatsApp(...phones);
      let results = contacts.map(contact => {
        return contact.jid.split('@')[0]
      });
      return {
        code: 200,
        message: "success",
        data: {
          phones: results
        }
      };
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }
}

module.exports = new AccountService();