const logger = require('../utils/logger');
const messageService = require('../services/message');
const { getConnection } = require('../services/baileys/connect');

class MessageController {
  /**
   * Send a message
   */
  async sendMessage(ctx) {
    try {
      //const { accountId, to, content, type = 'text', caption, mediaUrl } = ctx.request.body;
      ctx.body=await messageService.sendMessage(ctx.request.body)
   
      
    } catch (error) {
    
      ctx.body = {
        status:500,
        message: error.message
      };
    }
  }

  /**
   * Send a message
   */
  async sendLinkMessage(ctx) {
    try {
      //const { accountId, to, content, type = 'text', caption, mediaUrl } = ctx.request.body;
      ctx.body=await messageService.sendMessage(ctx.request.body)
   
      
    } catch (error) {
    
      ctx.body = {
        status:500,
        message: error.message
      };
    }
  }
  

  /**
   * Send bulk messages
   */
  async sendBulkMessages(ctx) {
    try {
      const { accountId, messages: messagesToSend } = ctx.request.body;
      
      const results = [];

      // Process each message
      for (const msg of messagesToSend) {
        try {
          // Generate a simple ID
          const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
          
          const message = {
            id,
            accountId,
            to: msg.to,
            content: msg.content,
            type: msg.type || 'text',
            caption: msg.caption,
            mediaUrl: msg.mediaUrl,
            status: 'sent',
            timestamp: new Date().toISOString()
          };

          // In a real implementation, this would send a WhatsApp message
          messages.push(message);
          
          results.push({
            id: message.id,
            status: 'sent'
          });
        } catch (err) {
          results.push({
            to: msg.to,
            status: 'failed',
            error: err.message
          });
        }
      }
      
      ctx.body = results;
    } catch (error) {
      logger.error('Error in sendBulkMessages:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
      };
    }
  }

  /**
   * Get message history
   */
  async getMessageHistory(ctx) {
    try {
      const { accountId, chatId, limit = 50} = ctx.request.body;
     
      const sock = await getConnection(accountId);
      if (!sock) {
        return {'status':500,'data':'cant get account info'}
      }
      const messages = await sock.fetchMessageHistory(chatId, limit);
      
      
      
      ctx.body = {'status':200,'data':messages};
    } catch (error) {
     
      ctx.body = {'status':500,'data':error.message};
    }
  }
}

module.exports = new MessageController(); 