const redisStorage = require('../services/redisStorage');
const { getConnection } = require('./baileys/connect');
const logger = require('../utils/logger');

class GroupService {
  /**
   * Create a new group
   */
  async createGroup(accountId, name, participants) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        throw new Error('WhatsApp connection not found');
      }

      const response = await sock.groupCreate(name, participants);
      const groupId = response.id;

      const group = await redisStorage.saveGroup({
        accountId,
        groupId,
        name,
        participants: participants.map(p => ({ id: p, isAdmin: false })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      return group;
    } catch (error) {
      logger.error('Error creating group:', error);
      throw error;
    }
  }

  async getGroups(accountId) {
    try {
      return await redisStorage.getGroupsByAccountId(accountId);
    } catch (error) {
      logger.error('Error getting groups:', error);
      throw error;
    }
  }

  async getGroupById(accountId, groupId) {
    try {
      return await redisStorage.getGroupById(accountId, groupId);
    } catch (error) {
      logger.error('Error getting group:', error);
      throw error;
    }
  }

  async updateGroupSettings(accountId, groupId, settings) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        throw new Error('WhatsApp connection not found');
      }

      const group = await this.getGroupById(accountId, groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      if (settings.subject) {
        await sock.groupUpdateSubject(groupId, settings.subject);
      }
      if (settings.description) {
        await sock.groupUpdateDescription(groupId, settings.description);
      }

      const updatedGroup = {
        ...group,
        name: settings.subject || group.name,
        description: settings.description || group.description,
        settings: { ...group.settings, ...settings },
        updatedAt: new Date().toISOString()
      };

      return await redisStorage.saveGroup(updatedGroup);
    } catch (error) {
      logger.error('Error updating group settings:', error);
      throw error;
    }
  }

  async addParticipants(accountId, groupId, participants) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        throw new Error('WhatsApp connection not found');
      }

      const group = await this.getGroupById(accountId, groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      await sock.groupParticipantsUpdate(groupId, participants, 'add');

      const currentParticipants = Array.isArray(group.participants) ? group.participants : [];
      const newParticipants = participants.map(p => ({ id: p, isAdmin: false }));
      const updatedGroup = {
        ...group,
        participants: [...currentParticipants, ...newParticipants],
        updatedAt: new Date().toISOString()
      };

      return await redisStorage.saveGroup(updatedGroup);
    } catch (error) {
      logger.error('Error adding participants:', error);
      throw error;
    }
  }

  async removeParticipant(accountId, groupId, participantId) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        throw new Error('WhatsApp connection not found');
      }

      const group = await this.getGroupById(accountId, groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      await sock.groupParticipantsUpdate(groupId, [participantId], 'remove');

      const participants = (Array.isArray(group.participants) ? group.participants : []).filter(p => p.id !== participantId);
      const updatedGroup = {
        ...group,
        participants,
        updatedAt: new Date().toISOString()
      };

      return await redisStorage.saveGroup(updatedGroup);
    } catch (error) {
      logger.error('Error removing participant:', error);
      throw error;
    }
  }
}

module.exports = new GroupService(); 