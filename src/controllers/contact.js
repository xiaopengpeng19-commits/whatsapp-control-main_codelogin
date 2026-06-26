const logger = require('../utils/logger');
const Contact = require('../models/Contact');
// In-memory storage for development
const contacts = [];

class ContactController {
  /**
   * Get all contacts
   */
  async getAllContacts(ctx) {
    try {
      const {accountId}=ctx.request.body;
      const contacts=await Contact.findAll({
        where:{
          accountId:accountId
        }
      });
      ctx.body = {
        status:200,
        data:contacts
      };
    } catch (error) {
      logger.error('Error in getAllContacts:', error);
      
      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }

 
}

module.exports = new ContactController(); 