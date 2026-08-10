// src/services/group.js
const redisStorage = require("../services/redisStorage");
const { getConnection } = require("./baileys/connect");
const nats = require("../config/nats");
const { group } = require("../utils/logger");
const logger = group;

class GroupService {
  /**
   * Create a new group
   */
  async CreateGroup(accountId, name, participants) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        throw new Error("WhatsApp connection not found");
      }

      const response = await sock.groupCreate(name, participants);
      const groupId = response.id;

      const group = await redisStorage.saveGroup({
        accountId,
        groupId,
        name,
        participants: participants.map((p) => ({ id: p, isAdmin: false })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await nats.publishMessage("group.event", {
        accountId: accountId,
        eventType: "group.created",
        data: {
          groupId: groupId,
          name: name,
          participants: participants,
        },
        timestamp: new Date().toISOString(),
      });

      return group;
    } catch (error) {
      logger.error("Error creating group:", error);
      throw error;
    }
  }

  /**
   * 获取群组列表（从 Redis）
   */
  async getGroups(accountId) {
    try {
      return await redisStorage.getGroupsByAccountId(accountId);
    } catch (error) {
      logger.error("Error getting groups:", error);
      throw error;
    }
  }

  /**
   * 获取单个群组（从 Redis）
   */
  async getGroupById(accountId, groupId) {
    try {
      return await redisStorage.getGroupById(accountId, groupId);
    } catch (error) {
      logger.error("Error getting group:", error);
      throw error;
    }
  }

  /**
   * 更新群组设置
   */
  async updateGroupSettings(accountId, groupId, settings) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        throw new Error("WhatsApp connection not found");
      }

      const group = await this.getGroupById(accountId, groupId);
      if (!group) {
        throw new Error("Group not found");
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
        updatedAt: new Date().toISOString(),
      };

      const result = await redisStorage.saveGroup(updatedGroup);

      await nats.publishMessage("group.event", {
        accountId: accountId,
        eventType: "group.update",
        data: {
          groupId: groupId,
          subject: settings.subject || null,
          description: settings.description || null,
        },
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      logger.error("Error updating group settings:", error);
      throw error;
    }
  }

  /**
   * 添加群成员
   */
  async addParticipants(accountId, groupId, participants) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        throw new Error("WhatsApp connection not found");
      }

      const group = await this.getGroupById(accountId, groupId);
      if (!group) {
        throw new Error("Group not found");
      }

      await sock.groupParticipantsUpdate(groupId, participants, "add");

      const currentParticipants = Array.isArray(group.participants) ? group.participants : [];
      const newParticipants = participants.map((p) => ({ id: p, isAdmin: false }));
      const updatedGroup = {
        ...group,
        participants: [...currentParticipants, ...newParticipants],
        updatedAt: new Date().toISOString(),
      };

      const result = await redisStorage.saveGroup(updatedGroup);

      await nats.publishMessage("group.event", {
        accountId: accountId,
        eventType: "group.participants.add",
        data: {
          groupId: groupId,
          participants: participants,
        },
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      logger.error("Error adding participants:", error);
      throw error;
    }
  }

  /**
   * 移除群成员
   */
  async removeParticipant(accountId, groupId, participantId) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        throw new Error("WhatsApp connection not found");
      }

      const group = await this.getGroupById(accountId, groupId);
      if (!group) {
        throw new Error("Group not found");
      }

      await sock.groupParticipantsUpdate(groupId, [participantId], "remove");

      const participants = (Array.isArray(group.participants) ? group.participants : []).filter((p) => p.id !== participantId);
      const updatedGroup = {
        ...group,
        participants,
        updatedAt: new Date().toISOString(),
      };

      const result = await redisStorage.saveGroup(updatedGroup);

      await nats.publishMessage("group.event", {
        accountId: accountId,
        eventType: "group.participants.remove",
        data: {
          groupId: groupId,
          participantId: participantId,
        },
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      logger.error("Error removing participant:", error);
      throw error;
    }
  }

  /**
   * 获取群组详情（直接从 WhatsApp 获取最新数据）
   */
  async GetGroupInfo(accountId, body) {
    try {
      const { groupId } = body;

      if (!groupId) {
        return { code: 400, message: "groupId is required", data: null };
      }

      const sock = await getConnection(accountId);
      if (!sock) {
        return { code: 500, message: "账号不存在或未连接", data: null };
      }

      const metadata = await sock.groupMetadata(groupId);

      return {
        code: 200,
        message: "success",
        data: {
          id: metadata.id,
          subject: metadata.subject,
          subjectTime: metadata.subjectTime,
          creation: metadata.creation,
          owner: metadata.owner,
          ownerPn: metadata.ownerPn,
          size: metadata.participants?.length || 0,
          announce: metadata.announce || false,
          restrict: metadata.restrict || false,
          ephemeralDuration: metadata.ephemeralDuration || 0,
          participants:
            metadata.participants?.map((p) => ({
              id: p.id,
              phoneNumber: p.phoneNumber || p.id.split("@")[0],
              admin: p.admin || null,
            })) || [],
          isCommunity: metadata.isCommunity || false,
          inviteCode: await sock.groupInviteCode(groupId).catch(() => null),
        },
      };
    } catch (error) {
      logger.error("[GetGroupInfo] 失败:", error);
      return { code: 500, message: error.message, data: null };
    }
  }

  /**
   * 获取群组列表（直接从 WhatsApp 获取最新数据）
   */
  async GetGroupList(accountId) {
    try {
      const sock = await getConnection(accountId);
      if (!sock) {
        return { code: 500, message: "账号不存在或未连接", data: null };
      }

      const groups = await sock.groupFetchAllParticipating();

      const groupList = Object.values(groups).map((g) => ({
        id: g.id,
        subject: g.subject,
        subjectTime: g.subjectTime,
        creation: g.creation,
        owner: g.owner,
        size: g.participants?.length || 0,
        announce: g.announce || false,
        restrict: g.restrict || false,
        ephemeralDuration: g.ephemeralDuration || 0,
        isCommunity: g.isCommunity || false,
      }));

      return {
        code: 200,
        message: "success",
        data: {
          total: groupList.length,
          groups: groupList,
        },
      };
    } catch (error) {
      logger.error("[GetGroupList] 失败:", error);
      return { code: 500, message: error.message, data: null };
    }
  }

  /**
   * 发送群组消息
   */
  async SendGroupMessage(accountId, body) {
    try {
      const { groupId, text, type = "text", media, caption } = body;

      if (!groupId) {
        return { code: 400, message: "groupId is required", data: null };
      }

      const sock = await getConnection(accountId);
      if (!sock) {
        return { code: 500, message: "账号不存在或未连接", data: null };
      }

      let message;
      switch (type) {
        case "text":
          if (!text) {
            return { code: 400, message: "text is required for text message", data: null };
          }
          message = { text: text };
          break;
        case "image":
          if (!media) {
            return { code: 400, message: "media is required for image message", data: null };
          }
          message = { image: Buffer.from(media, "base64"), caption: caption || "" };
          break;
        case "video":
          if (!media) {
            return { code: 400, message: "media is required for video message", data: null };
          }
          message = { video: Buffer.from(media, "base64"), caption: caption || "" };
          break;
        default:
          return { code: 400, message: `unsupported message type: ${type}`, data: null };
      }

      const result = await sock.sendMessage(groupId, message);

      await nats.publishMessage("group.event", {
        accountId: accountId,
        eventType: "group.message.sent",
        data: {
          groupId: groupId,
          messageId: result.key.id,
          type: type,
          text: text || null,
          caption: caption || null,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        code: 200,
        message: "消息发送成功",
        data: {
          groupId: groupId,
          messageId: result.key.id,
        },
      };
    } catch (error) {
      logger.error("[SendGroupMessage] 失败:", error);
      return { code: 500, message: error.message, data: null };
    }
  }

  /**
   * 退出群组
   */
  async LeaveGroup(accountId, body) {
    try {
      const { groupId } = body;

      if (!groupId) {
        return { code: 400, message: "groupId is required", data: null };
      }

      const sock = await getConnection(accountId);
      if (!sock) {
        return { code: 500, message: "账号不存在或未连接", data: null };
      }

      await sock.groupLeave(groupId);

      await nats.publishMessage("group.event", {
        accountId: accountId,
        eventType: "group.left",
        data: {
          groupId: groupId,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        code: 200,
        message: "已退出群组",
        data: {
          groupId: groupId,
        },
      };
    } catch (error) {
      logger.error("[LeaveGroup] 失败:", error);
      return { code: 500, message: error.message, data: null };
    }
  }

  /**
   * 获取群组邀请链接
   */
  async GetGroupInviteCode(accountId, body) {
    try {
      const { groupId } = body;

      if (!groupId) {
        return { code: 400, message: "groupId is required", data: null };
      }

      const sock = await getConnection(accountId);
      if (!sock) {
        return { code: 500, message: "账号不存在或未连接", data: null };
      }

      const inviteCode = await sock.groupInviteCode(groupId);

      return {
        code: 200,
        message: "success",
        data: {
          groupId: groupId,
          inviteCode: inviteCode,
          inviteLink: `https://chat.whatsapp.com/${inviteCode}`,
        },
      };
    } catch (error) {
      logger.error("[GetGroupInviteCode] 失败:", error);
      return { code: 500, message: error.message, data: null };
    }
  }

  /**
   * 通过邀请链接加入群组
   */
  async JoinGroupByInvite(accountId, body) {
    try {
      const { inviteCode } = body;

      if (!inviteCode) {
        return { code: 400, message: "inviteCode is required", data: null };
      }

      const sock = await getConnection(accountId);
      if (!sock) {
        return { code: 500, message: "账号不存在或未连接", data: null };
      }

      const result = await sock.groupAcceptInvite(inviteCode);

      await nats.publishMessage("group.event", {
        accountId: accountId,
        eventType: "group.joined",
        data: {
          groupId: result,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        code: 200,
        message: "加入群组成功",
        data: {
          groupId: result,
        },
      };
    } catch (error) {
      logger.error("[JoinGroupByInvite] 失败:", error);
      return { code: 500, message: error.message, data: null };
    }
  }

  /**
   * 群成员操作（添加/移除/提拔/降级）
   */
  async GroupParticipantsUpdate(accountId, body) {
    try {
      const { groupId, participants, action } = body;

      if (!groupId) {
        return { code: 400, message: "groupId is required", data: null };
      }
      if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return { code: 400, message: "participants must be a non-empty array", data: null };
      }
      if (!["add", "remove", "promote", "demote"].includes(action)) {
        return { code: 400, message: "action must be add/remove/promote/demote", data: null };
      }

      const sock = await getConnection(accountId);
      if (!sock) {
        return { code: 500, message: "账号不存在或未连接", data: null };
      }

      const result = await sock.groupParticipantsUpdate(groupId, participants, action);

      await nats.publishMessage("group.event", {
        accountId: accountId,
        eventType: `group.participants.${action}`,
        data: {
          groupId: groupId,
          participants: participants,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        code: 200,
        message: `群成员 ${action} 操作成功`,
        data: {
          groupId: groupId,
          action: action,
          participants: participants,
          result: result,
        },
      };
    } catch (error) {
      logger.error("[GroupParticipantsUpdate] 失败:", error);
      return { code: 500, message: error.message, data: null };
    }
  }
}

module.exports = new GroupService();
