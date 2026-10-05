const accountService = require("../services/account");
const { getModule } = require("../utils/logger");
const logger = getModule("controller");
const path = require("path");
const fs = require("fs");
const snowflake = require("../utils/snowflake");
const axios = require("axios");
const { getConnection } = require("../services/baileys/connect");

class AccountController {
  /**
   * 使用手机号码登录 WhatsApp（新的改进版本）
   * @param {Object} ctx - Koa context
   */
  async loginWithPhone(ctx) {
    try {
      const { phoneNumber, proxy, sessionId, callbackUrl } = ctx.request.body;

      if (!phoneNumber) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          message: "phone number is required",
          error: "PHONE_NUMBER_REQUIRED",
        };
        return;
      }

      // 构建登录数据
      const loginData = {
        phoneNumber,
        proxy,
        sessionId,
      };

      // 调用服务层方法
      logger.info("loginData:", loginData);
      const result = await accountService.loginWithPhoneNumber(loginData);

      // 如果有回调URL，在成功时调用
      if (callbackUrl && result.success && result.sock) {
        try {
          const axiosInstance = axios.create({
            timeout: 10000,
            headers: {
              "Content-Type": "application/json",
            },
          });

          await axiosInstance.post(callbackUrl, {
            accountId: result.accountId,
            phoneNumber: result.phoneNumber,
            status: "connected",
            timestamp: new Date().toISOString(),
          });

          logger.info(`callback send success: ${callbackUrl}`);
        } catch (callbackError) {
          logger.error("callbackError send error:", callbackError);
        }
      }

      ctx.status = 200;
      ctx.body = result;
    } catch (error) {
      logger.error("login failed for phone number:", error);

      ctx.status = 500;
      ctx.body = {
        success: false,
        message: error.message,
        error: "LOGIN_FAILED",
      };
    }
  }
  // src/controllers/account.js

  // ========== 扫码登录 ==========
  async loginByQrcode(ctx) {
    try {
      const { proxy, callbackurl, phoneNumber } = ctx.request.body;

      // ========== 1. 如果有手机号，先查是否已存在 ==========
      let existing = null;
      if (phoneNumber) {
        existing = await accountService.getAccountByPhoneNumberOrId(phoneNumber);

        // 检查凭证 + 账号状态
        if (existing) {
          const sessionDir = path.join(process.env.STORAGE_PATH || "./storage/sessions", String(existing.id));
          const credsPath = path.join(sessionDir, "creds.json");

          if (fs.existsSync(credsPath) && existing.account_status !== "expired" && existing.account_status !== "banned") {
            logger.info(`[${phoneNumber}] 凭证已存在，无需扫码`);
            ctx.body = {
              status: 201,
              data: "账号已登录",
              accountId: existing.id,
            };
            return;
          }
        }
      }

      // ========== 2. 凭证不存在或账号失效，走扫码流程 ==========
      let account;
      if (existing) {
        account = {
          ...existing,
          proxy: proxy || existing.proxy,
          account_status: "unconnected",
          socket_status: "disconnected",
        };
        logger.info(`[${phoneNumber}] 复用已有账号 ID: ${account.id}`);
      } else {
        account = {
          id: snowflake.nextId().toString(),
          mark: phoneNumber ? `Phone: ${phoneNumber}` : "",
          account_status: "unconnected",
          phoneNumber: phoneNumber || null,
          proxy: proxy,
          socket_status: "disconnected",
        };
        logger.info(`[${phoneNumber || "未知"}] 创建新账号 ID: ${account.id}`);
      }

      // ... 后续逻辑
    } catch (error) {
      // ...
    }
  }
  async loginByPairCode(ctx) {
    try {
      const { phone, proxy, callbackurl } = ctx.request.body;

      if (!phone) {
        ctx.body = {
          status: 400,
          data: "Phone number is required",
        };
        return;
      }

      // ========== 1. 先查账号是否已存在 ==========
      const existing = await accountService.getAccountByPhoneNumberOrId(phone);
      if (existing) {
        const sessionDir = path.join(process.env.STORAGE_PATH || "./storage/sessions", String(existing.id));
        const credsPath = path.join(sessionDir, "creds.json");

        // 检查凭证 + 账号状态
        if (fs.existsSync(credsPath) && existing.account_status !== "expired" && existing.account_status !== "banned") {
          logger.info(`[${phone}] 凭证已存在，无需配对码登录`);
          ctx.body = {
            status: 201,
            data: "账号已登录",
            accountId: existing.id,
          };
          return;
        }
      }

      // ========== 2. 凭证不存在或账号失效，走配对码流程 ==========
      let account;
      if (existing) {
        account = {
          ...existing,
          proxy: proxy || existing.proxy,
          account_status: "unconnected",
          socket_status: "disconnected",
        };
        logger.info(`[${phone}] 复用已有账号 ID: ${account.id}`);
      } else {
        account = {
          id: snowflake.nextId().toString(),
          mark: `Phone: ${phone}`,
          account_status: "unconnected",
          phoneNumber: phone,
          proxy: proxy,
          socket_status: "disconnected",
        };
        logger.info(`[${phone}] 创建新账号 ID: ${account.id}`);
      }

      // ... 后续逻辑
    } catch (error) {
      // ...
    }
  }
  async checkonwhatsapp(ctx) {
    try {
      const { accountId, phones } = ctx.request.body;
      const connection = await getConnection(accountId);
      if (!connection) {
        ctx.body = {
          status: 500,
          data: "Account not connected",
        };
      }
      logger.info("phones:", phones);
      if (phones.length == 0) {
        ctx.body = {
          status: 500,
          data: "Phones are required",
        };
      }
      const result = await connection.onWhatsApp(...phones);
      ctx.body = {
        status: 200,
        data: result,
      };
    } catch (error) {
      logger.error("Error in checkonwhatsapp:", error);

      ctx.body = {
        status: 500,
        data: error.message,
      };
    }
  }
  async getAllAccounts(ctx) {
    try {
      const accounts = await accountService.getAllAccounts();

      ctx.body = accounts;
    } catch (error) {
      logger.error("Error in getAllAccounts:", error);
      ctx.status = 500;
      ctx.body = {
        message: error.message,
      };
    }
  }

  /**
   * Create a new WhatsApp account
   */
  async createAccount(ctx) {
    try {
      const { name } = ctx.request.body;
      const account = await accountService.createAccount(name);

      ctx.status = 201;
      ctx.body = account;
    } catch (error) {
      logger.error("Error in createAccount:", error);
      ctx.status = 500;
      ctx.body = {
        message: error.message,
      };
    }
  }

  /**
   * Get a single WhatsApp account by ID
   */
  async getAccount(ctx) {
    try {
      const { id } = ctx.params;
      const account = await accountService.getAccount(id);

      if (!account) {
        ctx.status = 404;
        ctx.body = {
          message: "Account not found",
        };
        return;
      }

      ctx.body = account;
    } catch (error) {
      logger.error("Error in getAccount:", error);
      ctx.status = 500;
      ctx.body = {
        message: error.message,
      };
    }
  }

  /**
   * Connect a WhatsApp account
   */
  async connectAccount(ctx) {
    try {
      const { id } = ctx.params;
      const result = await accountService.connectAccount(id);

      ctx.body = result;
    } catch (error) {
      logger.error("Error in connectAccount:", error);
      ctx.status = error.status || 500;
      ctx.body = {
        message: error.message,
      };
    }
  }

  /**
   * Disconnect a WhatsApp account
   */
  async online(ctx) {
    try {
      const { id, proxy } = ctx.request.body; // ← 加上 proxy
      const result = await accountService.online(id, proxy); // ← 传给 service
      ctx.body = result;
    } catch (error) {
      logger.error("Error in online:", error);
      ctx.status = error.status || 500;
      ctx.body = {
        status: 500,
        data: error.message,
      };
    }
  }
  async disconnectAccount(ctx) {
    try {
      const { id } = ctx.params;
      const result = await accountService.disconnectAccount(id);

      ctx.body = result;
    } catch (error) {
      logger.error("Error in disconnectAccount:", error);
      ctx.status = error.status || 500;
      ctx.body = {
        message: error.message,
      };
    }
  }

  /**
   * Delete a WhatsApp account
   */
  async deleteAccount(ctx) {
    try {
      const { id } = ctx.request.body;

      await accountService.DeleteAccount(id);
      // Chats and contacts are now stored in Redis and will be removed by redisStorage.deleteAccount()
      try {
        // No SQL cleanup needed for Redis persistence
      } catch (e) {}
      const sessionDir = path.join(process.env.STORAGE_PATH || "./storage/sessions", id);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      ctx.body = {
        message: "Account deleted successfully",
      };
    } catch (error) {
      logger.error("Error in deleteAccount:", error);
      ctx.status = error.status || 500;
      ctx.body = {
        message: error.message,
      };
    }
  }

  // src/controllers/account.js - exportAccount 方法

  async exportAccount(ctx) {
    try {
      const { phone } = ctx.request.body;

      if (!phone) {
        ctx.status = 400;
        ctx.body = {
          code: 400,
          message: "phone is required",
          data: null,
        };
        return;
      }

      const account = await accountService.getAccountByPhoneNumberOrId(phone);
      if (!account) {
        ctx.body = {
          code: 404,
          message: "账号不存在或凭证未找到",
          data: null,
        };
        return;
      }

      // ========== 修复：确保 account.id 转成字符串 ==========
      const sessionDir = path.join(
        process.env.STORAGE_PATH || "./storage/sessions",
        String(account.id), // ← 转成字符串
      );
      const credsPath = path.join(sessionDir, "creds.json");

      if (!fs.existsSync(credsPath)) {
        ctx.body = {
          code: 404,
          message: "凭证文件不存在，请先登录该账号",
          data: null,
        };
        return;
      }

      try {
        const credsContent = fs.readFileSync(credsPath, "utf8");
        const creds = JSON.parse(credsContent);

        ctx.body = {
          code: 200,
          message: "success",
          data: {
            creds: creds,
          },
        };
      } catch (parseError) {
        logger.error(`[exportAccount] 解析凭证文件失败: ${phone}`, parseError);
        ctx.body = {
          code: 500,
          message: "凭证文件格式错误",
          data: null,
        };
      }
    } catch (error) {
      logger.error("Error in exportAccount:", error);
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: error.message,
        data: null,
      };
    }
  }
}

module.exports = new AccountController();
