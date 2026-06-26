const logger = require('../utils/logger');
const { getConnection} = require('../services/baileys/connect');
// In-memory storage for development
const groups = [];

class GroupController {
  /**
   * Get all groups
   */
  async getAllGroups(ctx) {
    try {
      // In a real implementation, this would fetch from a database
      

    } catch (error) {
      logger.error('Error in getAllGroups:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
      };
    }
  }

  /**
   * Create a new group
   */
  async createGroup(ctx) {
    try {
      const { title, accountId} = ctx.request.body;
      const connection=await getConnection(accountId);
      
      if(!connection){
        ctx.body={
          status:500,
          message:'Account not connected'
        }
        return;
      }
 
      const groupcreated=await connection.groupCreate(title,['8615936208327@s.whatsapp.net']);
      console.log('groupcreated',groupcreated);
      if(!groupcreated){
        ctx.body={
          status:500,
          message:'Group not created'
        }
        return;
      }
      ctx.body={
        status:200,
     
        data:groupcreated.id
      }
    } catch (error) {
      logger.error('Error in createGroup:', error);

      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }
  async leaveGroup(ctx) {
    try {
      const { groupId, accountId} = ctx.request.body;
      const connection=await getConnection(accountId);
      
      if(!connection){
        ctx.body={
          status:500,
          message:'Account not connected'
        }
        return;
      }
 
      await connection.groupLeave(groupId);
    
      ctx.body={
        status:200,
     
        data:'Group left successfully'
      }
    } catch (error) {
      logger.error('Error in createGroup:', error);

      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }
 async getInviteCode(ctx) {
    try {
      const { groupId, accountId} = ctx.request.body;
      const connection=await getConnection(accountId);
      
      if(!connection){
        ctx.body={
          status:500,
          message:'Account not connected'
        }
        return;
      }
 
      const code=await connection.groupInviteCode(groupId);
    
      ctx.body={
        status:200,
     
        data:code
      }
    } catch (error) {
      logger.error('Error in getInviteCode:', error);

      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }
  async joinGroup(ctx) {
    try {
      const { code, accountId} = ctx.request.body;
      const connection=await getConnection(accountId);
      
      if(!connection){
        ctx.body={
          status:500,
          message:'Account not connected'
        }
        return;
      }
 
      const responsed=await await connection.groupAcceptInvite(code)
    
      ctx.body={
        status:200,
     
        data:responsed
      }
    } catch (error) {
      logger.error('Error in getInviteCode:', error);

      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }
  async groupInfo(ctx) {
    try {
      const { groupId, accountId} = ctx.request.body;
      const connection=await getConnection(accountId);
      
      if(!connection){
        ctx.body={
          status:500,
          message:'Account not connected'
        }
        return;
      }
 
      const responsed=await await connection.groupMetadata(groupId)
    
      ctx.body={
        status:200,
     
        data:responsed
      }
    } catch (error) {
      logger.error('Error in getInviteCode:', error);

      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }
  async groupAllInfo(ctx) {
    try {
      const { accountId} = ctx.request.body;
      const connection=await getConnection(accountId);
      
      if(!connection){
        ctx.body={
          status:500,
          message:'Account not connected'
        }
        return;
      }
 
      const responsed=await await connection.groupFetchAllParticipating()
    
      ctx.body={
        status:200,
     
        data:responsed
      }
    } catch (error) {
      logger.error('Error in getInviteCode:', error);

      ctx.body = {
        status:500,
        data: error.message
      };
    }
  }
  

  /**
   * Get a group by ID
   */
  async getGroup(ctx) {
    try {
      const { id } = ctx.params;
      const group = groups.find(g => g.id === id);

      if (!group) {
        ctx.status = 404;
        ctx.body = {
          message: 'Group not found'
        };
        return;
      }

      ctx.body = group;
    } catch (error) {
      logger.error('Error in getGroup:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
      };
    }
  }

  /**
   * Add participants to a group
   */
  async addParticipants(ctx) {
    try {
      const { id } = ctx.params;
      const { participants } = ctx.request.body;
      
      const groupIndex = groups.findIndex(g => g.id === id);

      if (groupIndex === -1) {
        ctx.status = 404;
        ctx.body = {
          message: 'Group not found'
        };
        return;
      }

      // Add participants
      const group = groups[groupIndex];
      const newParticipants = Array.from(new Set([...group.participants, ...participants]));
      
      groups[groupIndex] = {
        ...group,
        participants: newParticipants,
        updatedAt: new Date().toISOString()
      };

      ctx.body = groups[groupIndex];
    } catch (error) {
      logger.error('Error in addParticipants:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
      };
    }
  }

  /**
   * Remove participants from a group
   */
  async removeParticipants(ctx) {
    try {
      const { id } = ctx.params;
      const { participants } = ctx.request.body;
      
      const groupIndex = groups.findIndex(g => g.id === id);

      if (groupIndex === -1) {
        ctx.status = 404;
        ctx.body = {
          message: 'Group not found'
        };
        return;
      }

      // Remove participants
      const group = groups[groupIndex];
      const newParticipants = group.participants.filter(p => !participants.includes(p));
      
      groups[groupIndex] = {
        ...group,
        participants: newParticipants,
        updatedAt: new Date().toISOString()
      };

      ctx.body = groups[groupIndex];
    } catch (error) {
      logger.error('Error in removeParticipants:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
      };
    }
  }

  /**
   * Delete a group
   */
  async deleteGroup(ctx) {
    try {
      const { id } = ctx.params;
      const groupIndex = groups.findIndex(g => g.id === id);

      if (groupIndex === -1) {
        ctx.status = 404;
        ctx.body = {
          message: 'Group not found'
        };
        return;
      }

      // Remove group
      groups.splice(groupIndex, 1);

      ctx.body = {
        message: 'Group deleted successfully'
      };
    } catch (error) {
      logger.error('Error in deleteGroup:', error);
      ctx.status = 500;
      ctx.body = {
        message: error.message
      };
    }
  }
}

module.exports = new GroupController(); 