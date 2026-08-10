const { getModule } = require("../utils/logger");
const logger = getModule("controller");
const redisStorage = require("../services/redisStorage");

class ChatController {
  /**
   * Get all chats
   */
  async getAllChats(ctx) {
    try {
      const { accountId } = ctx.request.body;
      const chats = await redisStorage.getChatsByAccountId(accountId);
      ctx.body = {
        status: 200,
        data: chats,
      };
    } catch (error) {
      logger.error("Error in getAllChats:", error);

      ctx.body = {
        status: 500,
        data: error.message,
      };
    }
  }
}

module.exports = new ChatController();
