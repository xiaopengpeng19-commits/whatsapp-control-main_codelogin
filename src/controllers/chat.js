const logger = require('../utils/logger');
const Chat = require('../models/Chat');
// In-memory storage for development
const chats = [];

class ChatController {
  /**
   * Get all chats
   */
  async getAllChats(ctx) {
    try {
      const {accountId}=ctx.request.body;
      const chats=await Chat.findAll({
        where:{
          accountId:accountId
        }
      });
      ctx.body = {
        status:200,
        data:chats
      };
    } catch (error) {
      logger.error('Error in getAllChats:', error);
      
      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }

 
}

module.exports = new ChatController(); 