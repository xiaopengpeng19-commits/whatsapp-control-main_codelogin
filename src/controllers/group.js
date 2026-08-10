// src/controllers/group.js
const { getModule } = require("../utils/logger");
const logger = getModule("controller");
const { getConnection } = require("../services/baileys/connect");
const groupService = require("../services/group");
const nats = require("../config/nats");

class GroupController {
  /**
   * Create a new group
   */
  async createGroup(ctx) {
    try {
      const { title, accountId, participants } = ctx.request.body;

      if (!title) {
        ctx.body = { code: 400, message: "title is required", data: null };
        return;
      }
      if (!accountId) {
        ctx.body = { code: 400, message: "accountId is required", data: null };
        return;
      }

      const result = await groupService.createGroup(
        accountId,
        title,
        participants || []
      );
      ctx.body = result;
    } catch (error) {
      logger.error("Error in createGroup:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Leave a group
   */
  async leaveGroup(ctx) {
    try {
      const { groupId, accountId } = ctx.request.body;

      if (!groupId) {
        ctx.body = { code: 400, message: "groupId is required", data: null };
        return;
      }
      if (!accountId) {
        ctx.body = { code: 400, message: "accountId is required", data: null };
        return;
      }

      const result = await groupService.LeaveGroup(accountId, { groupId });
      ctx.body = result;
    } catch (error) {
      logger.error("Error in leaveGroup:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Get group invite code
   */
  async getInviteCode(ctx) {
    try {
      const { groupId, accountId } = ctx.request.body;

      if (!groupId) {
        ctx.body = { code: 400, message: "groupId is required", data: null };
        return;
      }
      if (!accountId) {
        ctx.body = { code: 400, message: "accountId is required", data: null };
        return;
      }

      const result = await groupService.GetGroupInviteCode(accountId, {
        groupId,
      });
      ctx.body = result;
    } catch (error) {
      logger.error("Error in getInviteCode:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Join a group by invite code
   */
  async joinGroup(ctx) {
    try {
      const { code, accountId } = ctx.request.body;

      if (!code) {
        ctx.body = { code: 400, message: "code is required", data: null };
        return;
      }
      if (!accountId) {
        ctx.body = { code: 400, message: "accountId is required", data: null };
        return;
      }

      const result = await groupService.JoinGroupByInvite(accountId, {
        inviteCode: code,
      });
      ctx.body = result;
    } catch (error) {
      logger.error("Error in joinGroup:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Get group info from WhatsApp
   */
  async groupInfo(ctx) {
    try {
      const { groupId, accountId } = ctx.request.body;

      if (!groupId) {
        ctx.body = { code: 400, message: "groupId is required", data: null };
        return;
      }
      if (!accountId) {
        ctx.body = { code: 400, message: "accountId is required", data: null };
        return;
      }

      const result = await groupService.GetGroupInfo(accountId, { groupId });
      ctx.body = result;
    } catch (error) {
      logger.error("Error in groupInfo:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Get all groups from WhatsApp
   */
  async groupAllInfo(ctx) {
    try {
      const { accountId } = ctx.request.body;

      if (!accountId) {
        ctx.body = { code: 400, message: "accountId is required", data: null };
        return;
      }

      const result = await groupService.GetGroupList(accountId);
      ctx.body = result;
    } catch (error) {
      logger.error("Error in groupAllInfo:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Group participants update (add/remove/promote/demote)
   */
  async groupParticipantsUpdate(ctx) {
    try {
      const { groupId, accountId, participants, action } = ctx.request.body;

      if (!groupId) {
        ctx.body = { code: 400, message: "groupId is required", data: null };
        return;
      }
      if (!accountId) {
        ctx.body = { code: 400, message: "accountId is required", data: null };
        return;
      }
      if (!participants || !Array.isArray(participants) || participants.length === 0) {
        ctx.body = {
          code: 400,
          message: "participants must be a non-empty array",
          data: null,
        };
        return;
      }
      if (!["add", "remove", "promote", "demote"].includes(action)) {
        ctx.body = {
          code: 400,
          message: "action must be add/remove/promote/demote",
          data: null,
        };
        return;
      }

      const result = await groupService.GroupParticipantsUpdate(accountId, {
        groupId,
        participants,
        action,
      });
      ctx.body = result;
    } catch (error) {
      logger.error("Error in groupParticipantsUpdate:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Get group invite code (legacy)
   */
  async getGroup(ctx) {
    try {
      const { id } = ctx.params;
      // Not implemented - use groupInfo instead
      ctx.body = { code: 404, message: "Not implemented, use groupInfo", data: null };
    } catch (error) {
      logger.error("Error in getGroup:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Add participants (legacy)
   */
  async addParticipants(ctx) {
    try {
      const { id } = ctx.params;
      const { participants } = ctx.request.body;
      const { accountId } = ctx.request.body;

      if (!id) {
        ctx.body = { code: 400, message: "groupId is required", data: null };
        return;
      }

      const result = await groupService.GroupParticipantsUpdate(accountId, {
        groupId: id,
        participants: participants || [],
        action: "add",
      });
      ctx.body = result;
    } catch (error) {
      logger.error("Error in addParticipants:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Remove participants (legacy)
   */
  async removeParticipants(ctx) {
    try {
      const { id } = ctx.params;
      const { participants } = ctx.request.body;
      const { accountId } = ctx.request.body;

      if (!id) {
        ctx.body = { code: 400, message: "groupId is required", data: null };
        return;
      }

      const result = await groupService.GroupParticipantsUpdate(accountId, {
        groupId: id,
        participants: participants || [],
        action: "remove",
      });
      ctx.body = result;
    } catch (error) {
      logger.error("Error in removeParticipants:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Delete group (legacy)
   */
  async deleteGroup(ctx) {
    try {
      const { id } = ctx.params;
      ctx.body = { code: 404, message: "Not implemented, use LeaveGroup", data: null };
    } catch (error) {
      logger.error("Error in deleteGroup:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Send group message
   */
  async sendGroupMessage(ctx) {
    try {
      const { groupId, accountId, text, type, media, caption } = ctx.request.body;

      if (!groupId) {
        ctx.body = { code: 400, message: "groupId is required", data: null };
        return;
      }
      if (!accountId) {
        ctx.body = { code: 400, message: "accountId is required", data: null };
        return;
      }
      if (!text && type !== "image" && type !== "video") {
        ctx.body = { code: 400, message: "text is required", data: null };
        return;
      }

      const result = await groupService.SendGroupMessage(accountId, {
        groupId,
        text,
        type: type || "text",
        media,
        caption,
      });
      ctx.body = result;
    } catch (error) {
      logger.error("Error in sendGroupMessage:", error);
      ctx.body = { code: 500, message: error.message, data: null };
    }
  }
}

module.exports = new GroupController();