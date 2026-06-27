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
      const result = await this.SendButtonMessage(data);
      return result;
    } catch (e) {
      console.log(e);
      return { Success: false, ErrMsg: e.message };
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

    // 发送消息后，客户端会自动清除"正在输入…"状态，无需手动调用 paused

    console.log("response:", response);

    if (DeleteForMe) {
      this.deleteMessage(sock, jid, response.key.id);
    }
    return response;
  }

  /**
   * Send text message
   */
  async SendTextMsg(idorphone, body) {
    try {
      const { To, Text, DeleteForMe } = body;
      const sock = await getConnection(idorphone);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }
      let response = await this.sendMessageWTyping(sock, To, {
        text: Text,
        ...(DeleteForMe ? { deleteForMe: DeleteForMe } : {}),
      });
      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      console.log("SendTextMsg error:", error);
      return { Success: false, ErrMsg: error.message, To: To };
    }
  }

  /**
   * Send image message
   */
  async SendImageMsg(idorphone, data) {
    try {
      const { To, Base64Content, Caption, DeleteForMe } = data;
      const sock = await getConnection(idorphone);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }
      const media = Buffer.from(Base64Content, "base64");
      let response = await this.sendMessageWTyping(sock, To, {
        image: media,
        caption: Caption,
        ...(DeleteForMe ? { deleteForMe: DeleteForMe } : {}),
      });
      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      return { Success: false, ErrMsg: error.message, To: To };
    }
  }

  /**
   * Send video message
   */
  async SendVideoMsg(idorphone, data) {
    try {
      const { To, Base64Content, Caption, DeleteForMe } = data;
      const sock = await getConnection(idorphone);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }
      const media = Buffer.from(Base64Content, "base64");
      let response = await this.sendMessageWTyping(sock, To, {
        video: media,
        caption: Caption,
        ...(DeleteForMe ? { deleteForMe: DeleteForMe } : {}),
      });
      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      return { Success: false, ErrMsg: error.message, To: To };
    }
  }

  /**
   * Send message (generic)
   */
  async sendMessage(body) {
    try {
      const { accountId, to, content, type } = body;

      const sock = await getConnection(accountId);
      if (!sock) {
        return { status: 500, data: "cant get account info" };
      }
      let toid = normalizeJid(to);
      sock.lastActiveTime = new Date();

      if (type == "text") {
        await this.sendMessageWTyping(sock, toid, { text: content });
      } else if (type == "pic") {
        let base64mediadata = body.base64mediacontent;
        if (!base64mediadata) {
          return { status: 500, data: "base64mediadata is required" };
        }
        const media = Buffer.from(base64mediadata, "base64");
        await sock.sendMessage(toid, {
          image: media,
          caption: content,
        });
      } else if (type == "video") {
        // TODO: implement video
      } else if (type == "audio") {
        // TODO: implement audio
      } else if (type == "document") {
        // TODO: implement document
      }

      console.log("sendok! ",toid);
      return { status: 200, data: "send msg successfully" };
    } catch (error) {
      return { status: 500, data: error.message };
    }
  }

  async sendLinkMessage(body) {
    try{
      await this.SendButtonMessage(body)
    }catch(error){
      return { status: 500, data: error.message };
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
   * 统一的按钮消息发送核心 (使用 malvin-btns)
   */
  async SendButtonMessage(params) {
    const { accountId, to, title, body, footer, imageUrl, buttons } = params;
    const sock = await getConnection(accountId);
    if (!sock) {
      return { status: 500, data: "cant get account info" };
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

      if (ImageUrl) {
        buttonParams.image = { url: ImageUrl };
      }

      await sendButtons(sock, toid, buttonParams);

      return {
        Success: true,
        ErrMsg: "",
        To: To,
        Status: "sent"
      };
    } catch (error) {
      console.error("SendButtonMessage toid: ",toid," error: ", error);
      return {
        Success: false,
        ErrMsg: error.message || String(error),
        To: To,
        Status: "failed"
      };
    }
  }
}

module.exports = new MessageService();