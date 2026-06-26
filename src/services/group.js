const Group = require('../models/Group');
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

      // Create WhatsApp group
      const response = await sock.groupCreate(name, participants);
      const groupId = response.id;

      // Save to database
      const group = await Group.create({
        accountId,
        groupId,
        name,
        participants: participants.map(p => ({ id: p, isAdmin: false }))
      });

      return group;
    } catch (error) {
      logger.error('Error creating group:', error);
      throw error;
    }
  }

  /**
   * Get all groups for an account
   */
  async getGroups(accountId) {
    try {
      return await Group.findAll({
        where: { accountId },
        order: [['createdAt', 'DESC']]
      });
    } catch (error) {
      logger.error('Error getting groups:', error);
      throw error;
    }
  }

  /**
   * Get group by ID
   */
  async getGroupById(accountId, groupId) {
    try {
      return await Group.findOne({
        where: { accountId, groupId }
      });
    } catch (error) {
      logger.error('Error getting group:', error);
      throw error;
    }
  }

  /**
   * Update group settings
   */
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

      // Update WhatsApp group settings
      if (settings.subject) {
        await sock.groupUpdateSubject(groupId, settings.subject);
      }
      if (settings.description) {
        await sock.groupUpdateDescription(groupId, settings.description);
      }

      // Update database
      await group.update({
        name: settings.subject || group.name,
        description: settings.description || group.description,
        settings: { ...group.settings, ...settings }
      });

      return group;
    } catch (error) {
      logger.error('Error updating group settings:', error);
      throw error;
    }
  }

  /**
   * Add participants to group
   */
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

      // Add to WhatsApp group
      await sock.groupParticipantsUpdate(groupId, participants, 'add');

      // Update database
      const currentParticipants = group.participants || [];
      const newParticipants = participants.map(p => ({ id: p, isAdmin: false }));
      await group.update({
        participants: [...currentParticipants, ...newParticipants]
      });

      return group;
    } catch (error) {
      logger.error('Error adding participants:', error);
      throw error;
    }
  }

  /**
   * Remove participant from group
   */
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

      // Remove from WhatsApp group
      await sock.groupParticipantsUpdate(groupId, [participantId], 'remove');

      // Update database
      const participants = group.participants.filter(p => p.id !== participantId);
      await group.update({ participants });

      return group;
    } catch (error) {
      logger.error('Error removing participant:', error);
      throw error;
    }
  }
}

module.exports = new GroupService(); 