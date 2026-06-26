const MessageService = require('../services/message');

// 示例：如何使用不同的链接消息发送方式

// 方式1: 模板消息 - 适合正式商务场景
async function exampleTemplateMessage() {
  const data = {
    To: "1234567890",
    Title: "产品介绍",
    Body: "我们最新的产品已经上线，欢迎查看详细信息和购买。",
    Footer: "点击下方按钮访问产品页面",
    LinkUrl: "https://example.com/product",
    Buttons: [
      {
        index: 1,
        urlButton: {
          displayText: "查看产品",
          url: "https://example.com/product"
        }
      },
      {
        index: 2,
        callButton: {
          displayText: "联系我们",
          phoneNumber: "+1234567890"
        }
      }
    ]
  };
  
  const result = await MessageService.SendLinkMessageTemplate("account_id", data);
  console.log("模板消息发送结果:", result);
}

// 方式2: 列表消息 - 适合多个选项的场景
async function exampleListMessage() {
  const data = {
    To: "1234567890",
    Title: "服务选择",
    Description: "请选择您需要的服务类型",
    ButtonText: "选择服务",
    LinkUrl: "https://example.com/services"
  };
  
  const result = await MessageService.SendLinkMessageList("account_id", data);
  console.log("列表消息发送结果:", result);
}

// 方式3: 交互式消息 - 适合需要用户交互的场景
async function exampleInteractiveMessage() {
  const data = {
    To: "1234567890",
    Title: "活动邀请",
    Body: "我们即将举办一场线上活动，邀请您参加！",
    Footer: "请选择您的操作",
    LinkUrl: "https://example.com/event",
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
      {
        type: 1,
        reply: {
          id: "get_info",
          title: "获取详情"
        }
      }
    ]
  };
  
  const result = await MessageService.SendLinkMessageInteractive("account_id", data);
  console.log("交互式消息发送结果:", result);
}

// 方式4: 卡片式消息 - 适合产品展示
async function exampleCardMessage() {
  const data = {
    To: "1234567890",
    Title: "新品发布",
    Body: "我们刚刚发布了全新的产品系列，具有更好的性能和更优惠的价格。",
    ImageUrl: "https://example.com/product-image.jpg",
    LinkUrl: "https://example.com/new-product",
    ButtonText: "立即购买"
  };
  
  const result = await MessageService.SendLinkMessageCard("account_id", data);
  console.log("卡片式消息发送结果:", result);
}

// 方式5: 简单文本消息 - 适合快速分享链接
async function exampleSimpleMessage() {
  const data = {
    To: "1234567890",
    Title: "重要通知",
    Description: "请查看最新的公司公告和重要信息。",
    LinkUrl: "https://example.com/announcement"
  };
  
  const result = await MessageService.SendLinkMessageSimple("account_id", data);
  console.log("简单文本消息发送结果:", result);
}

// 方式6: 文档消息 - 适合分享文档和链接
async function exampleDocumentMessage() {
  const data = {
    To: "1234567890",
    Title: "技术文档",
    Description: "这是我们最新的技术文档，包含了详细的使用说明。",
    LinkUrl: "https://example.com/docs",
    DocumentUrl: "https://example.com/technical-doc.pdf"
  };
  
  const result = await MessageService.SendLinkMessageDocument("account_id", data);
  console.log("文档消息发送结果:", result);
}

// 使用示例
async function runExamples() {
  console.log("=== WhatsApp 链接消息发送示例 ===\n");
  
  try {
    console.log("1. 发送模板消息...");
    await exampleTemplateMessage();
    
    console.log("\n2. 发送列表消息...");
    await exampleListMessage();
    
    console.log("\n3. 发送交互式消息...");
    await exampleInteractiveMessage();
    
    console.log("\n4. 发送卡片式消息...");
    await exampleCardMessage();
    
    console.log("\n5. 发送简单文本消息...");
    await exampleSimpleMessage();
    
    console.log("\n6. 发送文档消息...");
    await exampleDocumentMessage();
    
  } catch (error) {
    console.error("示例执行出错:", error);
  }
}

// 导出示例函数
module.exports = {
  exampleTemplateMessage,
  exampleListMessage,
  exampleInteractiveMessage,
  exampleCardMessage,
  exampleSimpleMessage,
  exampleDocumentMessage,
  runExamples
};

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  runExamples();
} 