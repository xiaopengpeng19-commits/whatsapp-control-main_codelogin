// message.js - 修改所有方法返回统一格式
const redisStorage = require("../services/redisStorage");
const { getConnection } = require("./baileys/connect");
const logger = require("../utils/logger");

const { Buffer } = require("node:buffer");
const { delay } = require("../utils/common");
const { sendButtons } = require('malvin-btns');

function normalizeJid(jid) {
  if (!jid) return jid;
  return jid.includes("@") ? jid : `${jid}@s.whatsapp.net`;
}

class MessageService {
  /**
   * Delete a message
   */
  async deleteMessage(sock, jid, msgId) {
    let response = await sock.chatModify(
      { clear: { messages: [{ id: msgId, fromMe: true }] } },
      jid,
      []
    );
    console.log("response:", response);
    return response;
  }

  /**
   * Send link message (wrapper)
   */
  async SendLinkMessage(account, data) {
    try {
      data.accountId = account;
      const sock = await getConnection(account);
      if (!sock) {
        return { code: 500, message: "cant connect to whatsapp", data: null };
      }
      const result = await this.SendButtonMessage(data);
      return result;
    } catch (e) {
      console.log(e);
      return { code: 500, message: e.message, data: null };
    }
  }

  /**
   * Send message with typing indicator
   */
  async sendMessageWTyping(sock, jid, msg, DeleteForMe = false) {
    const targetJid = normalizeJid(jid);
    await sock.presenceSubscribe(targetJid);
    await delay(500);
    await sock.sendPresenceUpdate("composing", targetJid);
    await delay(500);
    let response = await sock.sendMessage(targetJid, msg);
    console.log("response:", response);
    if (DeleteForMe) {
      this.deleteMessage(sock, jid, response.key.id);
    }
    return response;
  }

  /**
   * Send text message - 统一返回格式
   */
  async SendTextMsg(idorphone, body) {
    try {
      const { To, Text, DeleteForMe } = body;
      const sock = await getConnection(idorphone);
      if (!sock) {
        return { code: 500, message: "cant connect to whatsapp", data: { to: To } };
      }
      let response = await this.sendMessageWTyping(sock, To, {
        text: Text,
        ...(DeleteForMe ? { deleteForMe: DeleteForMe } : {}),
      });
      return {
        code: 200,
        message: "success",
        data: {
          to: To,
          messageId: response.key.id
        }
      };
    } catch (error) {
      console.log("SendTextMsg error:", error);
      return { code: 500, message: error.message, data: { to: To } };
    }
  }

  /**
   * Send image message - 统一返回格式
   */
  async SendImageMsg(idorphone, data) {
    try {
      const { To, Base64Content, Caption, DeleteForMe } = data;
      const sock = await getConnection(idorphone);
      if (!sock) {
        return { code: 500, message: "cant connect to whatsapp", data: { to: To } };
      }
      const media = Buffer.from(Base64Content, "base64");
      let response = await this.sendMessageWTyping(sock, To, {
        image: media,
        caption: Caption,
        ...(DeleteForMe ? { deleteForMe: DeleteForMe } : {}),
      });
      return {
        code: 200,
        message: "success",
        data: {
          to: To,
          messageId: response.key.id
        }
      };
    } catch (error) {
      return { code: 500, message: error.message, data: { to: To } };
    }
  }

  /**
   * Send video message - 统一返回格式
   */
  async SendVideoMsg(idorphone, data) {
    try {
      const { To, Base64Content, Caption, DeleteForMe } = data;
      const sock = await getConnection(idorphone);
      if (!sock) {
        return { code: 500, message: "cant connect to whatsapp", data: { to: To } };
      }
      const media = Buffer.from(Base64Content, "base64");
      let response = await this.sendMessageWTyping(sock, To, {
        video: media,
        caption: Caption,
        ...(DeleteForMe ? { deleteForMe: DeleteForMe } : {}),
      });
      return {
        code: 200,
        message: "success",
        data: {
          to: To,
          messageId: response.key.id
        }
      };
    } catch (error) {
      return { code: 500, message: error.message, data: { to: To } };
    }
  }

  /**
   * Send message (generic) - 统一返回格式
   */
  async sendMessage(body) {
    try {
      const { accountId, to, content, type } = body;
      const sock = await getConnection(accountId);
      if (!sock) {
        return { code: 500, message: "cant get account info", data: null };
      }
      let toid = normalizeJid(to);
      sock.lastActiveTime = new Date();

      let response;
      if (type == "text") {
        response = await this.sendMessageWTyping(sock, toid, { text: content });
      } else if (type == "pic") {
        let base64mediadata = body.base64mediacontent;
        if (!base64mediadata) {
          return { code: 500, message: "base64mediadata is required", data: null };
        }
        const media = Buffer.from(base64mediadata, "base64");
        response = await sock.sendMessage(toid, {
          image: media,
          caption: content,
        });
      } else if (type == "video") {
        // TODO: implement video
        return { code: 500, message: "video not implemented", data: null };
      } else if (type == "audio") {
        return { code: 500, message: "audio not implemented", data: null };
      } else if (type == "document") {
        return { code: 500, message: "document not implemented", data: null };
      }

      console.log("sendok! ", toid);
      return {
        code: 200,
        message: "success",
        data: {
          to: to,
          messageId: response?.key?.id || null
        }
      };
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }

  async sendLinkMessage(body) {
    try {
      const result = await this.SendButtonMessage(body);
      return result;
    } catch (error) {
      return { code: 500, message: error.message, data: null };
    }
  }

  /**
   * Get chat history
   */
  async getChatHistory(accountId, chatId, limit = 50, offset = 0) {
    try {
      return await redisStorage.getMessagesByChat(chatId, limit, offset);
    } catch (error) {
      logger.error("Error getting chat history:", error);
      throw error;
    }
  }

  /**
   * Update message status
   */
  async updateMessageStatus(messageId, status) {
    try {
      return await redisStorage.updateMessageStatus(messageId, status);
    } catch (error) {
      logger.error("Error updating message status:", error);
      throw error;
    }
  }

  /**
   * 统一的按钮消息发送核心 (使用 malvin-btns) - 统一返回格式
   */
  async SendButtonMessage(params) {
    const { accountId, to, title, body, footer, imageUrl, buttons } = params;
    const sock = await getConnection(accountId);
    if (!sock) {
      return { code: 500, message: "cant get account info", data: null };
    }

    let toid = normalizeJid(to);

    try {
      const formattedButtons = buttons.map(btn => {
        if (btn.name && btn.buttonParamsJson) {
          return btn;
        }
        if (btn.url) {
          return {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: btn.display_text || '访问链接',
              url: btn.url
            })
          };
        }
        if (btn.phoneNumber) {
          return {
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({
              display_text: btn.display_text || '拨打电话',
              phone_number: btn.phoneNumber
            })
          };
        }
        return {
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: btn.display_text || '按钮',
            id: btn.id || `btn_${Date.now()}`
          })
        };
      });

      const buttonParams = {
        title: title || '',
        text: body || '',
        footer: footer || '',
        buttons: formattedButtons
      };

      if (imageUrl) {
        buttonParams.image = { url: imageUrl };
      }

      let response = await sendButtons(sock, toid, buttonParams);

      return {
        code: 200,
        message: "success",
        data: {
          to: to,
          messageId: response.key.id
        }
      };
    } catch (error) {
      console.error("SendButtonMessage toid: ", toid, " error: ", error);
      return {
        code: 500,
        message: error.message || String(error),
        data: { to: toid }
      };
    }
  }
}

module.exports = new MessageService();