const accountService = require('../services/account');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const snowflake = require("../utils/snowflake");
const axios = require("axios");
const { getConnection} = require('../services/baileys/connect');

class AccountController {
  /**
   * 使用手机号码登录 WhatsApp（新的改进版本）
   * @param {Object} ctx - Koa context
   */
  async loginWithPhone(ctx) {
    try {
      const { 
        phoneNumber, 
        proxy, 
        sessionId, 
        callbackUrl 
      } = ctx.request.body;

      if (!phoneNumber) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          message: 'phone number is required',
          error: 'PHONE_NUMBER_REQUIRED'
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
      console.log("loginData:",loginData);
      const result = await accountService.loginWithPhoneNumber(loginData);

      // 如果有回调URL，在成功时调用
      if (callbackUrl && result.success && result.sock) {
        try {
          const axiosInstance = axios.create({
            timeout: 10000,
            headers: {
              'Content-Type': 'application/json'
            }
          });
          
          await axiosInstance.post(callbackUrl, {
            accountId: result.accountId,
            phoneNumber: result.phoneNumber,
            status: 'connected',
            timestamp: new Date().toISOString()
          });
          
          logger.info(`callback send success: ${callbackUrl}`);
        } catch (callbackError) {
          logger.error('callbackError send error:', callbackError);
        }
      }

      ctx.status = 200;
      ctx.body = result;

    } catch (error) {
      logger.error('login failed for phone number:', error);
      
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: error.message,
        error: 'LOGIN_FAILED'
      };
    }
  }
  /**
   * Login to WhatsApp account using QR code
   * @param {Object} ctx - Koa context
   */
  async loginByQrcode(ctx) {
    try {
      const { proxy } = ctx.request.body;
      const {callbackurl}=ctx.request.body;
      // Create a new account if not exists
      let account = {
        id: snowflake.nextId().toString(),
        mark: '',
        account_status: 'unconnected',
        phoneNumber: null,
        proxy: proxy,
        socket_status:'disconnected'
      };
      let callbackfun=null;
      callbackfun=async()=>{
          console.log('callbackurl_callbackfun:',callbackurl);
          // Save the account to the database
          try {
            const Account = require('../models/Account');
            const newAccount = await Account.create({
              id: account.id,
              mark: account.mark,
              proxy: account.proxy,
              phoneNumber: account.phoneNumber,
              socket_status: 'connected',
              account_status: 'normal'
            });
            console.log('Account saved to database:', newAccount.id);
          } catch (dbError) {
            console.error('Failed to save account to database:', dbError);
            // Continue execution even if database save fails
          }
          if(callbackurl){
            const axios = require('axios');
            const axiosInstance = axios.create({

              headers: {
                'Content-Type': 'application/json'
              }
            });
            try{
              const response = await axiosInstance.get(callbackurl);
            }catch(error){
              console.log("error:",error)
            }
           
          }
        }
      
      // Connect to WhatsApp and generate QR code
      const result = await accountService.GetQRCode(account,callbackfun);
      console.log('resultincotroller:',result);
      if(result.Success){
        ctx.body = {
          status: 200,
          data: result.Data,
          accountId: account.id
        };
      }else{
        ctx.body = {
          status: 500,
          data: result.data
        };
      }

    } catch (error) {
      logger.error('Error in loginByQrcode1:', error);
      ctx.status = error.status || 500;
      ctx.body = {
        message: error.message
      };
    }
  }
  async loginByPairCode(ctx) {
    try {
    
      const {phone,proxy,callbackurl}=ctx.request.body;
      if(!phone){
        ctx.body = {
          status: 500,
          data: 'Phone number is required'
        };
      }
      
      // Create a new account if not exists
      let account = {
        id: snowflake.nextId().toString(),
        mark: '',
        account_status: 'unconnected',
        phoneNumber: phone,
        proxy: proxy,
        socket_status:'disconnected'
      };
      let callbackfun=null;
      
        console.log("callbackurl:",callbackurl)
        callbackfun=async()=>{
          console.log('callbackurl:',callbackurl);
          // Save the account to the database
          try {
            const Account = require('../models/Account');
            const newAccount = await Account.create({
              id: account.id,
              mark: account.mark,
              proxy: account.proxy,
              phoneNumber: account.phoneNumber,
              socket_status: 'connected',
              account_status: 'normal'
            });
            console.log('Account saved to database:', newAccount.id);
          } catch (dbError) {
            console.error('Failed to save account to database:', dbError);
            // Continue execution even if database save fails
          }
          if(callbackurl){
            const axios = require('axios');
            const axiosInstance = axios.create({

              headers: {
                'Content-Type': 'application/json'
              }
            });
            try{
              const response = await axiosInstance.get(callbackurl);
            }catch(error){
              console.log("error:",error)
            }
           
          }
        }
      
      // Connect to WhatsApp and generate QR code
      const result = await accountService.getPairCode(account,callbackfun);
      console.log('result get pair  code',result);
      if(result.status==403){
        ctx.body = {
          status: 200,
          data: result.qr,
          accountId: account.id
        };
      }else{
        // ctx.body = {
        //   status: 500,
        //   data: result.data
        // };
      }

    } catch (error) {
      logger.error('Error in loginByQrcode2:', error);
      ctx.status = error.status || 500;
      ctx.body = {
        message: error.message
      };
    }
  }
  async checkonwhatsapp(ctx){
    try {
      const { accountId,phones } = ctx.request.body;
      const connection=await getConnection(accountId);
      if(!connection){
        ctx.body = {
          status: 500,
          data: 'Account not connected'
        };
      }
      console.log("phones:",phones)
      if(phones.length==0){
        ctx.body = {
          status: 500,
          data: 'Phones are required'
        };
      }
      const result=await connection.onWhatsApp(...phones);
      ctx.body ={
        status:200,
        data:result
      }
    } catch (error) {
      logger.error('Error in checkonwhatsapp:', error);
      
      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }
  async getAllAccounts(ctx) {
    try {
      const accounts = await accountService.getAllAccounts();

      ctx.body = accounts;
    } catch (error) {
      logger.error('Error in getAllAccounts:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
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
      logger.error('Error in createAccount:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
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
          message: 'Account not found'
        };
        return;
      }

      ctx.body = account;
    } catch (error) {
      logger.error('Error in getAccount:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
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
      logger.error('Error in connectAccount:', error);
      ctx.status = error.status || 500;
      ctx.body = {
        message: error.message
      };
    }
  }

  /**
   * Disconnect a WhatsApp account
   */
  async online(ctx) {
    try {
      const { id } = ctx.request.body;
      const result = await accountService.online(id);
      ctx.body = result;
    } catch (error) {
      logger.error('Error in online:', error);
      ctx.status = error.status || 500;
      ctx.body = {
        status: 500,
        data: error.message
      };
    }
  }
  async disconnectAccount(ctx) {
    try {
      const { id } = ctx.params;
      const result = await accountService.disconnectAccount(id);

      ctx.body = result;
    } catch (error) {
      logger.error('Error in disconnectAccount:', error);
      ctx.status = error.status || 500;
      ctx.body = {
        message: error.message
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
      try{
        const Chat = require('../models/Chat');
        await Chat.destroy({
          where:{
            accountId:id
          }
        });
        const Contact = require('../models/Contact');
        await Contact.destroy({
          where:{
            accountId:id
          }
        });
        
      }catch(e){}
      const sessionDir = path.join(process.env.STORAGE_PATH || './storage/sessions', id);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      ctx.body = {
        message: 'Account deleted successfully'
      };
    } catch (error) {
      logger.error('Error in deleteAccount:', error);
      ctx.status = error.status || 500;
      ctx.body = {
        message: error.message
      };
    }
  }
}

module.exports = new AccountController();