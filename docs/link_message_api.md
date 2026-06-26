# WhatsApp 链接消息发送 API 文档

本文档介绍了6种不同的发送带链接消息的方式，每种方式都有其特定的使用场景和优势。

## 基础信息

- **基础URL**: `http://your-domain/api/messages`
- **认证**: 需要在请求头中包含认证信息
- **响应格式**: JSON

## 1. 模板消息 (Template Message)

适合正式商务场景，支持URL按钮和电话按钮。

**端点**: `POST /api/messages/link/template`

**请求体**:
```json
{
  "accountId": "your_account_id",
  "To": "1234567890",
  "Title": "产品介绍",
  "Body": "我们最新的产品已经上线，欢迎查看详细信息和购买。",
  "Footer": "点击下方按钮访问产品页面",
  "LinkUrl": "https://example.com/product",
  "Buttons": [
    {
      "index": 1,
      "urlButton": {
        "displayText": "查看产品",
        "url": "https://example.com/product"
      }
    },
    {
      "index": 2,
      "callButton": {
        "displayText": "联系我们",
        "phoneNumber": "+1234567890"
      }
    }
  ]
}
```

**响应**:
```json
{
  "Success": true,
  "ErrMsg": "",
  "To": "1234567890",
  "MessageId": "message_id_here"
}
```

## 2. 列表消息 (List Message)

适合多个选项的场景，提供下拉列表选择。

**端点**: `POST /api/messages/link/list`

**请求体**:
```json
{
  "accountId": "your_account_id",
  "To": "1234567890",
  "Title": "服务选择",
  "Description": "请选择您需要的服务类型",
  "ButtonText": "选择服务",
  "LinkUrl": "https://example.com/services"
}
```

## 3. 交互式消息 (Interactive Message)

适合需要用户交互的场景，支持多个按钮选项。

**端点**: `POST /api/messages/link/interactive`

**请求体**:
```json
{
  "accountId": "your_account_id",
  "To": "1234567890",
  "Title": "活动邀请",
  "Body": "我们即将举办一场线上活动，邀请您参加！",
  "Footer": "请选择您的操作",
  "LinkUrl": "https://example.com/event",
  "Buttons": [
    {
      "type": 1,
      "reply": {
        "id": "join_event",
        "title": "参加活动"
      }
    },
    {
      "type": 1,
      "reply": {
        "id": "share_event",
        "title": "分享活动"
      }
    },
    {
      "type": 1,
      "reply": {
        "id": "get_info",
        "title": "获取详情"
      }
    }
  ]
}
```

## 4. 卡片式消息 (Card Message)

适合产品展示，包含图片、标题、描述和按钮。

**端点**: `POST /api/messages/link/card`

**请求体**:
```json
{
  "accountId": "your_account_id",
  "To": "1234567890",
  "Title": "新品发布",
  "Body": "我们刚刚发布了全新的产品系列，具有更好的性能和更优惠的价格。",
  "ImageUrl": "https://example.com/product-image.jpg",
  "LinkUrl": "https://example.com/new-product",
  "ButtonText": "立即购买"
}
```

## 5. 简单文本消息 (Simple Text Message)

适合快速分享链接，格式简单清晰。

**端点**: `POST /api/messages/link/simple`

**请求体**:
```json
{
  "accountId": "your_account_id",
  "To": "1234567890",
  "Title": "重要通知",
  "Description": "请查看最新的公司公告和重要信息。",
  "LinkUrl": "https://example.com/announcement"
}
```

## 6. 文档消息 (Document Message)

适合分享文档和链接，支持PDF等文档格式。

**端点**: `POST /api/messages/link/document`

**请求体**:
```json
{
  "accountId": "your_account_id",
  "To": "1234567890",
  "Title": "技术文档",
  "Description": "这是我们最新的技术文档，包含了详细的使用说明。",
  "LinkUrl": "https://example.com/docs",
  "DocumentUrl": "https://example.com/technical-doc.pdf"
}
```

## 使用场景建议

### 1. 模板消息
- **适用场景**: 正式商务沟通、产品推广、客户服务
- **优势**: 支持多种按钮类型，界面专业
- **示例**: 产品介绍、服务咨询、客户支持

### 2. 列表消息
- **适用场景**: 多选项选择、服务分类、菜单展示
- **优势**: 结构清晰，选项丰富
- **示例**: 服务选择、产品分类、功能菜单

### 3. 交互式消息
- **适用场景**: 用户交互、活动参与、问卷调查
- **优势**: 交互性强，用户体验好
- **示例**: 活动邀请、用户反馈、投票调查

### 4. 卡片式消息
- **适用场景**: 产品展示、新闻分享、内容推广
- **优势**: 视觉效果好，信息丰富
- **示例**: 产品发布、新闻分享、内容推广

### 5. 简单文本消息
- **适用场景**: 快速分享、简单通知、日常沟通
- **优势**: 简单直接，兼容性好
- **示例**: 链接分享、简单通知、日常沟通

### 6. 文档消息
- **适用场景**: 文档分享、技术资料、学习资源
- **优势**: 支持文档格式，信息完整
- **示例**: 技术文档、学习资料、合同文件

## 错误处理

所有API都会返回统一的错误格式：

```json
{
  "Success": false,
  "ErrMsg": "错误描述信息",
  "To": "目标号码"
}
```

常见错误：
- `cant connect to whatsapp`: WhatsApp连接失败
- `Invalid phone number`: 无效的手机号码
- `Message too long`: 消息内容过长
- `Invalid URL`: 无效的链接地址

## 注意事项

1. **手机号码格式**: 支持带国家代码的完整号码（如：1234567890）或带@s.whatsapp.net后缀的JID
2. **链接格式**: 必须包含http://或https://协议
3. **图片URL**: 必须是可公开访问的图片链接
4. **文档URL**: 必须是可公开访问的文档链接
5. **按钮数量**: 交互式消息最多支持3个按钮
6. **消息长度**: 文本内容建议不超过1000字符

## 测试示例

可以使用以下curl命令测试API：

```bash
# 测试简单文本消息
curl -X POST http://localhost:3000/api/messages/link/simple \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "test_account",
    "To": "1234567890",
    "Title": "测试消息",
    "Description": "这是一个测试消息",
    "LinkUrl": "https://example.com"
  }'
``` 