const axios = require('axios');

// 测试配置
const BASE_URL = 'http://localhost:3000/api/messages';
const ACCOUNT_ID = 'test_account_123';
const TEST_PHONE = '1234567890';

// 测试数据
const testData = {
  // 简单文本消息测试
  simple: {
    accountId: ACCOUNT_ID,
    To: TEST_PHONE,
    Title: "测试通知",
    Description: "这是一个测试消息，包含重要链接。",
    LinkUrl: "https://www.baidu.com"
  },

  // 模板消息测试
  template: {
    accountId: ACCOUNT_ID,
    To: TEST_PHONE,
    Title: "产品推广",
    Body: "我们最新的产品已经上线，具有更好的性能和更优惠的价格。",
    Footer: "点击下方按钮了解更多",
    LinkUrl: "https://www.baidu.com",
    Buttons: [
      {
        index: 1,
        urlButton: {
          displayText: "查看产品",
          url: "https://www.baidu.com"
        }
      }
    ]
  },

  // 交互式消息测试
  interactive: {
    accountId: ACCOUNT_ID,
    To: TEST_PHONE,
    Title: "活动邀请",
    Body: "我们即将举办一场线上活动，邀请您参加！",
    Footer: "请选择您的操作",
    LinkUrl: "https://www.baidu.com",
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
          id: "get_info",
          title: "获取详情"
        }
      }
    ]
  },

  // 卡片式消息测试
  card: {
    accountId: ACCOUNT_ID,
    To: TEST_PHONE,
    Title: "新品发布",
    Body: "我们刚刚发布了全新的产品系列，具有更好的性能和更优惠的价格。",
    ImageUrl: "https://via.placeholder.com/300x200",
    LinkUrl: "https://www.baidu.com",
    ButtonText: "立即查看"
  }
};

// 测试函数
async function testLinkMessage(type, data) {
  try {
    console.log(`\n=== 测试 ${type} 消息 ===`);
    console.log('发送数据:', JSON.stringify(data, null, 2));
    
    const response = await axios.post(`${BASE_URL}/link/${type}`, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('响应结果:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(`测试 ${type} 消息失败:`, error.response?.data || error.message);
    return null;
  }
}

// 运行所有测试
async function runAllTests() {
  console.log('开始测试 WhatsApp 链接消息发送功能...\n');
  
  const results = {};
  
  // 测试简单文本消息
  results.simple = await testLinkMessage('simple', testData.simple);
  
  // 测试模板消息
  results.template = await testLinkMessage('template', testData.template);
  
  // 测试交互式消息
  results.interactive = await testLinkMessage('interactive', testData.interactive);
  
  // 测试卡片式消息
  results.card = await testLinkMessage('card', testData.card);
  
  // 输出测试总结
  console.log('\n=== 测试总结 ===');
  Object.keys(results).forEach(type => {
    const result = results[type];
    const status = result?.Success ? '✅ 成功' : '❌ 失败';
    console.log(`${type}: ${status}`);
    if (result?.ErrMsg) {
      console.log(`  错误信息: ${result.ErrMsg}`);
    }
  });
}

// 如果直接运行此文件，则执行测试
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testLinkMessage,
  runAllTests,
  testData
}; 