const Message = require("../models/Message");
const { getConnection } = require("./baileys/connect");
const logger = require("../utils/logger");

const { Buffer } = require("node:buffer");
const { delay } = require("../utils/common");

function normalizeJid(jid) {
  if (!jid) return jid;
  return jid.includes("@") ? jid : `${jid}@s.whatsapp.net`;
}

class MessageService {
  /**
   * Send a message
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
  async SendLinkMessage(account, data) {
    let To = "355698125899";
    const sock = await getConnection("355698125899");
    if (!sock) {
      return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
    }
    let jid = "355684088277@s.whatsapp.net";
    console.log("1111111111111111111111111111111111111");
    try {
      let account = "355698125899";
      let data = {
        accountId: "355698125899",
        To: "355692036085@s.whatsapp.net",
        Title: "产品介绍",
        Description: "我们最新的产品已经上线，欢迎查看详细信息和购买。",
        Body: "我们最新的产品已经上线，欢迎查看详细信息和购买。",
        ImageUrl: "https://gips3.baidu.com/it/u=3886271102,3123389489&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960",
        Footer: "点击下方按钮访问产品页面",
        ButtonText: "选择服务",
        LinkUrl: "https://www.baidu.com/",
        Buttons: [
          {
            type: 1,
            reply: {
              id: "join_event",
              title: "参加活动"
            }
          },
          {
            type: 1,
            reply: {
              id: "share_event",
              title: "分享活动"
            }
          },
        ],
      };
      await this.SendLinkMessageCard(account, data);
      // let response=await sock.sendMessage(jid,
      //   {
      //     image:{"url":"https://gips1.baidu.com/it/u=313648070,2144261500&fm=3042&app=3042&f=JPEG&wm=1,baiduai,0,0,13,9&wmo=0,0&w=640&h=480"},
      //     caption:"This is a test message",
      //     footer:"点击按钮跳转",
      //     buttons: [
      //       {buttonId: 'button1', buttonText: {displayText: '点击跳转到百度'}, type: 1}
      //     ],
      //     headerType: 4,
      //     viewOnce: false
      //   }

      // )
    } catch (e) {
      console.log(e);
    }
    return response;
  }
  async sendMessageWTyping(sock, jid, msg, DeleteForMe = false) {
    const targetJid = normalizeJid(jid);

    await sock.presenceSubscribe(targetJid);
    await delay(500);

    await sock.sendPresenceUpdate("composing", targetJid);
    await delay(500);

    await sock.sendPresenceUpdate("paused", targetJid);
    let response = await sock.sendMessage(targetJid, msg);
    console.log("response:", response);
    this.deleteMessage(sock, jid, response.key.id);
    return response;
  }
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

  async sendMessage(body) {
    try {
      const { accountId, to, content, type = "text" } = body;

      const sock = await getConnection(accountId);
      if (!sock) {
        return { status: 500, data: "cant get account info" };
      }
      let toid = normalizeJid(to);
      // Update lastActiveTime on socket
      //console.log("msgtype:",type);
      sock.lastActiveTime = new Date();
      if (type == "text") {
        //const sentMsg  = await sock.sendMessage(toid, { text:content })
        let response = await this.sendMessageWTyping(sock, toid, {
          text: content,
        });
      } else if (type == "pic") {
        let base64mediadata = body.base64mediacontent;
        if (!base64mediadata) {
          return { status: 500, data: "base64mediadata is required" };
        }
        const media = Buffer.from(base64mediadata, "base64");
        const sentMsg = await sock.sendMessage(toid, {
          image: media,
          caption: content,
        });
      } else if (type == "video") {
      } else if (type == "audio") {
      } else if (type == "document") {
      }

      console.log("sendok!");

      return { status: 200, data: "send msg successfully" };
    } catch (error) {
      return { status: 500, data: error.message };
    }
  }

  /**
   * Get chat history
   */
  async getChatHistory(accountId, chatId, limit = 50, offset = 0) {
    try {
      return await Message.findAll({
        where: { accountId, chatId },
        order: [["createdAt", "DESC"]],
        limit,
        offset,
      });
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
      const message = await Message.findByPk(messageId);
      if (!message) {
        throw new Error("Message not found");
      }

      await message.update({ status });
      return message;
    } catch (error) {
      logger.error("Error updating message status:", error);
      throw error;
    }
  }

  // async handleButtonResponse(sock, msg) {
  //   const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId;
  //   if (buttonId === 'button1') {
  //     await sock.sendMessage(msg.key.remoteJid, {
  //       text: 'https://www.baidu.com\n\n点击上面的链接跳转到百度'
  //     });
  //   }
  // }

  // 方式1: 使用模板消息发送链接
  async SendLinkMessageTemplate(account, data) {
    try {
      const { To, Title, Body, Footer, Buttons, LinkUrl } = data;
      const sock = await getConnection(account);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }

      let jid = To;
      if (jid.indexOf("@") == -1) {
        jid = jid + "@s.whatsapp.net";
      }

      const response = await sock.sendMessage(jid, {
        text: {
          text: `*${Title}*\n\n${Body}\n\n${LinkUrl}`,
        },
        footer: Footer || "点击链接访问",
        templateButtons: Buttons || [
          {
            index: 1,
            urlButton: {
              displayText: "访问链接",
              url: LinkUrl,
            },
          },
        ],
      });

      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      console.log("SendLinkMessageTemplate error:", error);
      return { Success: false, ErrMsg: error.message, To: data.To };
    }
  }

  // 方式2: 使用列表消息发送链接
  async SendLinkMessageList(account, data) {
    try {
      const { To, Title, Description, ButtonText, LinkUrl } = data;
      const sock = await getConnection(account);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }

      let jid = To;
      if (jid.indexOf("@") == -1) {
        jid = jid + "@s.whatsapp.net";
      }

      const response = await sock.sendMessage(jid, {
        list: {
          title: Title || "链接分享",
          description: Description || "点击下方按钮访问链接",
          buttonText: ButtonText || "查看详情",
          sections: [
            {
              title: "链接信息",
              rows: [
                {
                  title: "访问链接",
                  description: LinkUrl,
                  rowId: "link_1",
                },
              ],
            },
          ],
          listType: 1,
        },
      });

      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      console.log("SendLinkMessageList error:", error);
      return { Success: false, ErrMsg: error.message, To: data.To };
    }
  }

  // 方式3: 使用交互式消息发送链接
  async SendLinkMessageInteractive(account, data) {
    try {
      const { To, Title, Body, Footer, Buttons, LinkUrl } = data;
      const sock = await getConnection(account);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }

      let jid = To;
      if (jid.indexOf("@") == -1) {
        jid = jid + "@s.whatsapp.net";
      }

      const response = await sock.sendMessage(jid, {
        interactive: {
          type: "button",
          header: {
            type: "text",
            text: Title || "链接分享",
          },
          body: {
            text: Body || `点击下方按钮访问链接：\n${LinkUrl}`,
          },
          footer: {
            text: Footer || "选择操作",
          },
          action: {
            buttons: Buttons || [
              {
                type: 1,
                reply: {
                  id: "visit_link",
                  title: "访问链接",
                },
              },
              {
                type: 1,
                reply: {
                  id: "copy_link",
                  title: "复制链接",
                },
              },
            ],
          },
        },
      });

      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      console.log("SendLinkMessageInteractive error:", error);
      return { Success: false, ErrMsg: error.message, To: data.To };
    }
  }

  // 方式4: 使用卡片式消息发送链接
  async SendLinkMessageCard(account, data) {
    try {
      const { To, Title, Body, ImageUrl, LinkUrl, ButtonText } = data;
      const sock = await getConnection(account);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }

      let jid = To;
      if (jid.indexOf("@") == -1) {
        jid = jid + "@s.whatsapp.net";
      }

      const response = await sock.sendMessage(jid, {
        image: { url: ImageUrl || "https://via.placeholder.com/300x200" },
        caption: `*${Title}*\n\n${Body}\n\n${LinkUrl}`,
        footer: "点击图片或链接访问",
        buttons: [
          {
            buttonId: "visit_link",
            buttonText: { displayText: ButtonText || "访问链接" },
            type: 1,
          },
        ],
        headerType: 4,
        viewOnce: false,
      });

      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      console.log("SendLinkMessageCard error:", error);
      return { Success: false, ErrMsg: error.message, To: data.To };
    }
  }

  // 方式5: 使用简单文本消息发送链接
  async SendLinkMessageSimple(account, data) {
    try {
      const { To, Title, Description, LinkUrl } = data;
      const sock = await getConnection(account);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }

      let jid = To;
      if (jid.indexOf("@") == -1) {
        jid = jid + "@s.whatsapp.net";
      }

      const messageText = `*${Title}*\n\n${Description}\n\n🔗 ${LinkUrl}\n\n点击链接直接访问`;

      const response = await sock.sendMessage(jid, { text: messageText });

      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      console.log("SendLinkMessageSimple error:", error);
      return { Success: false, ErrMsg: error.message, To: data.To };
    }
  }

  // 方式6: 使用文档消息发送链接
  async SendLinkMessageDocument(account, data) {
    try {
      const { To, Title, Description, LinkUrl, DocumentUrl } = data;
      const sock = await getConnection(account);
      if (!sock) {
        return { Success: false, ErrMsg: "cant connect to whatsapp", To: To };
      }

      let jid = To;
      if (jid.indexOf("@") == -1) {
        jid = jid + "@s.whatsapp.net";
      }

      const response = await sock.sendMessage(jid, {
        document: { url: DocumentUrl || "https://example.com/document.pdf" },
        caption: `*${Title}*\n\n${Description}\n\n🔗 相关链接：${LinkUrl}`,
        footer: "点击文档查看详情",
        buttons: [
          {
            buttonId: "visit_link",
            buttonText: { displayText: "访问链接" },
            type: 1,
          },
        ],
        headerType: 1,
      });

      return { Success: true, ErrMsg: "", To: To, MessageId: response.key.id };
    } catch (error) {
      console.log("SendLinkMessageDocument error:", error);
      return { Success: false, ErrMsg: error.message, To: data.To };
    }
  }
}

module.exports = new MessageService();
