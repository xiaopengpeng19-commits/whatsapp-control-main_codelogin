# WhatsApp 链接消息发送功能

本项目提供了6种不同的发送带链接消息的方式，每种方式都有其特定的使用场景和优势。

## 🚀 功能特点

- **6种消息类型**: 支持模板、列表、交互式、卡片、简单文本、文档等多种消息格式
- **灵活配置**: 每种消息类型都支持自定义标题、内容、按钮等
- **统一API**: 所有消息类型都使用统一的API接口和响应格式
- **错误处理**: 完善的错误处理和日志记录
- **易于扩展**: 模块化设计，便于添加新的消息类型

## 📋 消息类型概览

| 类型 | 方法名 | 适用场景 | 特点 |
|------|--------|----------|------|
| 模板消息 | `SendLinkMessageTemplate` | 正式商务沟通 | 支持URL和电话按钮 |
| 列表消息 | `SendLinkMessageList` | 多选项选择 | 下拉列表结构 |
| 交互式消息 | `SendLinkMessageInteractive` | 用户交互 | 多个按钮选项 |
| 卡片式消息 | `SendLinkMessageCard` | 产品展示 | 图片+文字+按钮 |
| 简单文本消息 | `SendLinkMessageSimple` | 快速分享 | 简单直接 |
| 文档消息 | `SendLinkMessageDocument` | 文档分享 | 支持PDF等格式 |

## 🛠️ 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
npm start
```

### 3. 发送消息

#### 简单文本消息示例

```javascript
const MessageService = require('./src/services/message');

const data = {
  To: "1234567890",
  Title: "重要通知",
  Description: "请查看最新的公司公告。",
  LinkUrl: "https://example.com/announcement"
};

const result = await MessageService.SendLinkMessageSimple("account_id", data);
console.log(result);
```

#### API调用示例

```bash
curl -X POST http://localhost:3000/api/messages/link/simple \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "your_account_id",
    "To": "1234567890",
    "Title": "测试消息",
    "Description": "这是一个测试消息",
    "LinkUrl": "https://example.com"
  }'
```

## 📖 详细使用说明

### 1. 模板消息 (Template Message)

适合正式商务场景，支持URL按钮和电话按钮。

```javascript
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

await MessageService.SendLinkMessageTemplate("account_id", data);
```

### 2. 列表消息 (List Message)

适合多个选项的场景，提供下拉列表选择。

```javascript
const data = {
  To: "1234567890",
  Title: "服务选择",
  Description: "请选择您需要的服务类型",
  ButtonText: "选择服务",
  LinkUrl: "https://example.com/services"
};

await MessageService.SendLinkMessageList("account_id", data);
```

### 3. 交互式消息 (Interactive Message)

适合需要用户交互的场景，支持多个按钮选项。

```javascript
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
    }
  ]
};

await MessageService.SendLinkMessageInteractive("account_id", data);
```

### 4. 卡片式消息 (Card Message)

适合产品展示，包含图片、标题、描述和按钮。

```javascript
const data = {
  To: "1234567890",
  Title: "新品发布",
  Body: "我们刚刚发布了全新的产品系列，具有更好的性能和更优惠的价格。",
  ImageUrl: "https://example.com/product-image.jpg",
  LinkUrl: "https://example.com/new-product",
  ButtonText: "立即购买"
};

await MessageService.SendLinkMessageCard("account_id", data);
```

### 5. 简单文本消息 (Simple Text Message)

适合快速分享链接，格式简单清晰。

```javascript
const data = {
  To: "1234567890",
  Title: "重要通知",
  Description: "请查看最新的公司公告和重要信息。",
  LinkUrl: "https://example.com/announcement"
};

await MessageService.SendLinkMessageSimple("account_id", data);
```

### 6. 文档消息 (Document Message)

适合分享文档和链接，支持PDF等文档格式。

```javascript
const data = {
  To: "1234567890",
  Title: "技术文档",
  Description: "这是我们最新的技术文档，包含了详细的使用说明。",
  LinkUrl: "https://example.com/docs",
  DocumentUrl: "https://example.com/technical-doc.pdf"
};

await MessageService.SendLinkMessageDocument("account_id", data);
```

## 🔧 API接口

### 基础信息

- **基础URL**: `http://your-domain/api/messages`
- **认证**: 需要在请求头中包含认证信息
- **响应格式**: JSON

### 接口列表

| 方法 | 端点 | 描述 |
|------|------|------|
| POST | `/api/messages/link/template` | 发送模板消息 |
| POST | `/api/messages/link/list` | 发送列表消息 |
| POST | `/api/messages/link/interactive` | 发送交互式消息 |
| POST | `/api/messages/link/card` | 发送卡片式消息 |
| POST | `/api/messages/link/simple` | 发送简单文本消息 |
| POST | `/api/messages/link/document` | 发送文档消息 |

### 响应格式

成功响应：
```json
{
  "Success": true,
  "ErrMsg": "",
  "To": "1234567890",
  "MessageId": "message_id_here"
}
```

错误响应：
```json
{
  "Success": false,
  "ErrMsg": "错误描述信息",
  "To": "目标号码"
}
```

## 🧪 测试

### 运行测试

```bash
# 运行所有测试
node test_link_messages.js

# 运行特定测试
node src/examples/link_message_examples.js
```

### 测试覆盖

- ✅ 简单文本消息
- ✅ 模板消息
- ✅ 交互式消息
- ✅ 卡片式消息
- ✅ 列表消息
- ✅ 文档消息

## 📁 项目结构

```
src/
├── services/
│   └── message.js          # 消息服务（包含所有链接消息方法）
├── controllers/
│   └── message.js          # 消息控制器
├── routes/
│   └── message.js          # 消息路由
├── examples/
│   └── link_message_examples.js  # 使用示例
└── docs/
    └── link_message_api.md       # API文档

test_link_messages.js       # 测试脚本
README_link_messages.md     # 本文档
```

## ⚠️ 注意事项

1. **手机号码格式**: 支持带国家代码的完整号码或带@s.whatsapp.net后缀的JID
2. **链接格式**: 必须包含http://或https://协议
3. **图片URL**: 必须是可公开访问的图片链接
4. **文档URL**: 必须是可公开访问的文档链接
5. **按钮数量**: 交互式消息最多支持3个按钮
6. **消息长度**: 文本内容建议不超过1000字符

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个项目。

## 📄 许可证

本项目采用MIT许可证。 