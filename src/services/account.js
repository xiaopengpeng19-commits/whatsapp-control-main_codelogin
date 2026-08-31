// account.js - 修改所有方法返回统一格式
const snowflake = require("../utils/snowflake");
const { auth } = require("../utils/logger");
const logger = auth;
const { getConnection, createConnection, GetAccountStateFromConnection, CloseConnection } = require("./baileys/connect");
const { formatPhoneNumber, isValidPhoneNumber, smartFormatPhoneNumber } = require("../utils/phoneFormatter");
const redisStorage = require("./redisStorage");
const path = require("path");
const fs = require("fs");
class AccountService {
  /**
   * 使用手机号码登录 WhatsApp
   */
  async loginWithPhoneNumber(loginData) {
    const { phoneNumber, proxy, sessionId } = loginData;

    try {
      if (!phoneNumber) {
        throw new Error("手机号码是必需的");
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
        account_status: "unconnected",
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
            socket_status: "connected",
            account_status: "normal",
            sessionId: sessionId,
          });
          logger.info("Account upserted to Redis:", account.phoneNumber);
        } catch (dbError) {
          logger.error("Failed to save/update account to Redis:", dbError);
        }
      };

      const result = await createConnection(account, callbackfun, false);

      if (result.status === 500) {
        throw new Error("cant connect to whatsapp server");
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
            message: "pairing code generated, please input this code in your app",
          },
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
            sock: result.sock,
          },
        };
      }

      throw new Error("unknown connection status");
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
      mark: "",
      account_status: "unconnected",
      phoneNumber: null,
      proxy: proxy,
      socket_status: "disconnected",
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
          accountState: accountState,
        });
      }
      return {
        code: 200,
        message: "success",
        data: {
          accounts: result,
        },
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
      mark: "",
      account_status: "unconnected",
      phoneNumber: null,
      proxy: proxy,
      socket_status: "disconnected",
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
          socket_status: "connected",
          account_status: "normal",
          sessionId: SessionId,
        });
        logger.info("Account upserted to Redis:", account.phoneNumber);
      } catch (dbError) {
        logger.error("Failed to save/update account to Redis:", dbError);
      }
    };

    logger.info("callbackfuncgetQrCode", account);
    let result = await createConnection(account, callbackfun);
    logger.info("resultgetQrCode:", result);

    if (result.status == "failed") {
      return {
        code: 500,
        message: "cant connect to whatsapp",
        data: null,
      };
    }
    if (result.status == "waiting_qr") {
      return {
        code: 200,
        message: "qr code generated",
        data: {
          qrCode: result.qr,
        },
      };
    }
    return {
      code: 500,
      message: `unknown status: ${result.status}`,
      data: null,
    };
  }

  // src/services/account.js - getPairCode 方法

  async getPairCode(account, callbackurl) {
    logger.info("callbackfuncgetPairCode", callbackurl);

    try {
      const result = await createConnection(account, callbackurl, true);
      logger.info("resultgetPairCode:", result);

      // ========== 防御性检查 ==========
      if (!result) {
        return {
          status: 500,
          data: "createConnection 返回空结果",
        };
      }

      if (result.status === 500 || result.status === "failed") {
        return {
          status: 500,
          data: result.error || "连接失败",
        };
      }

      if (result.status === 403 || result.status === "waiting_pair_code") {
        return {
          status: 403,
          qr: result.code || result.qr,
        };
      }

      if (result.status === 200 || result.status === "connected") {
        return {
          status: 200,
          data: "连接成功",
        };
      }

      return {
        status: 500,
        data: `未知状态: ${result.status}`,
      };
    } catch (error) {
      logger.error("getPairCode error:", error);
      return {
        status: 500,
        data: error.message,
      };
    }
  }

  /**
   * Disconnect an account
   */
  async disconnectAccount(id) {
    const account = await this.getAccount(id);
    if (!account) {
      return { code: 404, message: "Account not found", data: null };
    }
    const updated = await redisStorage.updateAccount(account.id, {
      socket_status: "disconnected",
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
            account: account.phoneNumber,
          },
        };
      } else {
        return {
          code: 404,
          message: "not found in db",
          data: null,
        };
      }
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }

  async GetAccountState2(account) {
    const statusmap = {
      banned: 5,
      expired: 4,
      normal: 3,
      unconnected: 1,
      logged_out: 1,
      logging: 2,
      banned: 5,
    };
    try {
      const sockstatus = await GetAccountStateFromConnection(account.phoneNumber);
      if (sockstatus) {
        logger.info("sockstatus:", sockstatus);
        return statusmap[sockstatus.account_status] || 1;
      }
      logger.info("account.account_status:", account.account_status);
      if (account.account_status == "banned") {
        return 5;
      } else if (account.account_status == "expired") {
        return 4;
      } else if (account.account_status == "normal") {
        return 3;
      } else if (account.account_status == "unconnected") {
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

  // services/account.js - ContactsList

  async ContactsList(idorphone, body) {
    try {
      // ========== 先通过手机号查 accountId ==========
      const account = await this.getAccountByPhoneNumberOrId(idorphone);
      if (!account) {
        return { code: 404, message: "账号不存在", data: null };
      }

      const contacts = await redisStorage.getContactsByAccountId(account.id);
      return {
        code: 200,
        message: "success",
        data: { contacts },
      };
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }
  // ========== AddContact（单人添加） ==========
  async AddContact(idorphone, body) {
    try {
      const { phone, displayName } = body;

      if (!phone) {
        return { code: 400, message: "phone is required", data: null };
      }

      const sock = await getConnection(idorphone);
      if (!sock) {
        return { code: 500, message: "账号未连接", data: null };
      }

      // 1. 先检查号码是否在 WhatsApp 上
      const result = await sock.onWhatsApp(phone);
      if (!result || !result.length || !result[0].exists) {
        return { code: 400, message: "号码未注册 WhatsApp", data: null };
      }

      // 2. 使用 onWhatsApp 返回的 jid
      const jid = result[0].jid; // 例如: "244927587772@s.whatsapp.net"

      // 3. 调用官方 addOrEditContact
      await sock.addOrEditContact(jid, {
        displayName: displayName || phone,
        name: displayName || phone,
        phoneNumber: phone,
      });

      // 4. 保存到 Redis
      await redisStorage.upsertChat({
        accountId: idorphone,
        accountPhone: idorphone,
        peerPhone: phone,
        peerId: jid,
        peerName: displayName || phone,
        isGroup: false,
        contactAdded: true,
      });

      logger.info(`[AddContact] 已添加联系人: ${phone} -> ${jid}`);

      return {
        code: 200,
        message: "联系人添加成功",
        data: { phone, jid, displayName: displayName || phone },
      };
    } catch (error) {
      logger.error(`[AddContact] 添加联系人失败:`, error);
      return { code: 500, message: error.message, data: null };
    }
  }
  async AddContactsBatch(idorphone, body) {
    return { code: 400, message: "批量添加功能暂未开放", data: null };
  }

  async GetPhoneCode(idorphone) {
    // 暂时返回空
    return { code: 200, message: "success", data: null };
  }

  // services/account.js

  // src/services/account.js - Online 方法

  async Online(idorphone, body = {}) {
    try {
      const proxyOverride = body?.proxy || null;

      const account = await this.getAccountByPhoneNumberOrId(idorphone);
      if (!account) {
        return { code: 404, message: "账号不存在", data: null };
      }

      const useProxy = proxyOverride || account.proxy || null;
      if (useProxy && useProxy !== account.proxy) {
        await redisStorage.updateAccount(account.id, { proxy: useProxy });
        logger.info(`[${idorphone}] 更新 proxy: ${useProxy}`);
      }

      const connection = await getConnection(idorphone, null, useProxy);
      if (connection) {
        return { code: 200, message: "online", data: null };
      } else {
        return { code: 500, message: "连接失败", data: null };
      }
    } catch (error) {
      logger.error(`[${idorphone}] 上线失败:`, error);

      // ========== 根据错误类型返回不同 code ==========
      if (error.type === "CREDENTIALS_EXPIRED") {
        return { code: error.code || 401, message: error.message, data: null };
      }

      if (error.type === "MANUAL_CLOSE") {
        return { code: 200, message: "已手动关闭", data: null };
      }

      return { code: error.code || 500, message: error.message || "连接失败", data: null };
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
      } catch (error) {}

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
      let results = contacts.map((contact) => {
        return contact.jid.split("@")[0];
      });
      return {
        code: 200,
        message: "success",
        data: {
          phones: results,
        },
      };
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }

  // src/services/account.js - 添加 ImportAccount 方法

  /**
   * 导入账号凭证
   * @param {string} accountId - 账号ID（手机号或自定义ID）
   * @param {Object} body - 请求体
   * @param {Object} body.creds - 凭证数据
   * @param {string} body.phoneNumber - 手机号
   * @param {string} body.proxy - 代理（可选）
   * @param {string} body.sessionId - 会话ID（可选）
   * @returns {Promise<Object>} 导入结果
   */
  // src/services/account.js - 在文件顶部添加 require

  // 在 class AccountService 中添加
  /**
   * 导入账号凭证（只导入，不自动登录）
   * @param {string} accountId - 账号ID（手机号）
   * @param {Object} body - 请求体
   * @param {Object} body.creds - 凭证数据
   * @param {string} body.phoneNumber - 手机号（可选，默认用 accountId）
   * @param {string} body.proxy - 代理（可选）
   * @param {string} body.sessionId - 会话ID（可选）
   * @returns {Promise<Object>} 导入结果
   */
  async ImportAccount(accountId, body) {
    try {
      const { creds, phoneNumber, proxy, sessionId } = body;

      // 1. 验证必要参数
      if (!creds) {
        return { code: 400, message: "creds is required", data: null };
      }

      // 手机号：优先用 body.phoneNumber，其次用 accountId，最后从 creds 提取
      const finalPhone = phoneNumber || accountId || creds.Phone || creds.me?.id?.split(":")[0];
      if (!finalPhone) {
        return { code: 400, message: "phoneNumber is required", data: null };
      }

      // 2. 验证 creds 格式
      if (!creds.me || !creds.me.id) {
        return {
          code: 400,
          message: "Invalid creds format: missing me.id",
          data: null,
        };
      }

      // 3. 保存 creds 到文件系统
      const sessionDir = path.join(process.env.STORAGE_PATH || "./storage/sessions", finalPhone);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const credsPath = path.join(sessionDir, "creds.json");

      // 写入文件
      fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
      logger.info(`[ImportAccount] Creds saved to ${credsPath}`);

      // 4. 保存账号信息到 Redis
      try {
        const redisStorage = require("./redisStorage");
        await redisStorage.upsertAccount({
          id: finalPhone,
          mark: `Phone: ${finalPhone}`,
          proxy: proxy || null,
          phoneNumber: finalPhone,
          socket_status: "disconnected", // 导入后处于离线状态
          account_status: "normal",
          sessionId: sessionId || null,
        });
        logger.info(`[ImportAccount] Account saved to Redis: ${finalPhone}`);
      } catch (redisError) {
        logger.error(`[ImportAccount] Failed to save to Redis:`, redisError);
        // 不阻断流程，文件已经保存了
      }

      // 5. 返回结果（不自动登录）
      return {
        code: 200,
        message: "Account imported successfully",
        data: {
          accountId: finalPhone,
          phoneNumber: finalPhone,
          socket_status: "disconnected",
          credsPath: credsPath,
          importedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error(`[ImportAccount] Error:`, error);
      return {
        code: 500,
        message: error.message,
        data: null,
      };
    }
  }

  /**
   * 处理凭证数据，确保 Buffer 格式正确
   */
  _processCredsForStorage(creds) {
    // 如果 creds 是字符串，尝试解析
    let data = creds;
    if (typeof creds === "string") {
      try {
        data = JSON.parse(creds);
      } catch (e) {
        // 如果不是 JSON，直接返回
        return creds;
      }
    }

    // 递归处理，确保所有 Buffer 数据格式正确
    return this._convertBufferFields(data);
  }

  _convertBufferFields(obj) {
    if (!obj || typeof obj !== "object") {
      return obj;
    }

    // 如果是 Buffer 对象格式 { data: "...", type: "Buffer" }
    if (obj.type === "Buffer" && obj.data) {
      return {
        data: obj.data,
        type: "Buffer",
      };
    }

    // 如果是数组，递归处理每个元素
    if (Array.isArray(obj)) {
      return obj.map((item) => this._convertBufferFields(item));
    }

    // 如果是对象，递归处理每个字段
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this._convertBufferFields(value);
    }
    return result;
  }
}

module.exports = new AccountService();
