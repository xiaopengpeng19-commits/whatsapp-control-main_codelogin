/**
 * WhatsApp 手机号码登录示例
 * 
 * 本示例展示如何使用手机号码登录 WhatsApp
 * 基于 Baileys Wiki 文档: https://baileys.wiki/docs/socket/connecting
 */

const axios = require('axios');

// 服务器基础 URL
const BASE_URL = 'http://localhost:8080/api';

/**
 * 示例 1: 基本手机号码登录
 */
async function basicPhoneLogin() {
  try {
    console.log('=== 基本手机号码登录示例 ===');
    
    const response = await axios.post(`${BASE_URL}/accounts/loginByPhone`, {
      phoneNumber: '8613800138000',  // 中国手机号码示例
      defaultCountryCode: '86'       // 中国国家代码
    });

    if (response.data.success) {
      console.log('✅ 登录请求成功');
      console.log('📱 手机号码:', response.data.phoneNumber);
      console.log('🔢 配对码:', response.data.pairingCode);
      console.log('📝 说明:', response.data.message);
      console.log('📋 操作步骤:');
      response.data.instructions.forEach((instruction, index) => {
        console.log(`   ${instruction}`);
      });
    } else {
      console.log('❌ 登录失败:', response.data.message);
    }
  } catch (error) {
    console.error('❌ 请求失败:', error.response?.data || error.message);
  }
}

/**
 * 示例 2: 使用代理的手机号码登录
 */
async function phoneLoginWithProxy() {
  try {
    console.log('\n=== 使用代理的手机号码登录示例 ===');
    
    const response = await axios.post(`${BASE_URL}/accounts/loginByPhone`, {
      phoneNumber: '+1-234-567-8901',           // 美国手机号码格式
      defaultCountryCode: '1',                  // 美国国家代码
      proxy: 'socks5://127.0.0.1:1080',        // SOCKS5 代理配置
      sessionId: 'my-session-001',              // 自定义会话ID
      callbackUrl: 'http://127.0.0.1:9999/api/accountcallback'  // 连接成功回调
    });

    if (response.data.success) {
      console.log('✅ 代理登录请求成功');
      console.log('🌐 使用代理: socks5://127.0.0.1:1080');
      console.log('📱 格式化手机号码:', response.data.phoneNumber);
      console.log('🔢 配对码:', response.data.pairingCode);
    }
  } catch (error) {
    console.error('❌ 代理登录失败:', error.response?.data || error.message);
  }
}

/**
 * 示例 3: 多种手机号码格式处理
 */
async function phoneFormatExamples() {
  console.log('\n=== 手机号码格式处理示例 ===');
  
  const phoneNumbers = [
    '13800138000',              // 中国本地格式
    '+86 138 0013 8000',        // 带国家代码和空格
    '86-138-0013-8000',         // 带连字符
    '+1 (234) 567-8901',        // 美国格式
    '44 7700 900123',           // 英国格式
  ];

  for (const phone of phoneNumbers) {
    try {
      console.log(`\n📞 测试号码: ${phone}`);
      
      // 根据号码判断可能的国家代码
      let countryCode = '86';  // 默认中国
      if (phone.includes('+1') || phone.includes('(')) {
        countryCode = '1';     // 美国
      } else if (phone.includes('44') || phone.includes('+44')) {
        countryCode = '44';    // 英国
      }
      
      const response = await axios.post(`${BASE_URL}/account/loginByPhone`, {
        phoneNumber: phone,
        defaultCountryCode: countryCode
      });

      if (response.data.success) {
        console.log(`   ✅ 格式化成功: ${response.data.phoneNumber}`);
        console.log(`   🔢 配对码: ${response.data.pairingCode}`);
      }
    } catch (error) {
      console.log(`   ❌ 格式化失败: ${error.response?.data?.message || error.message}`);
    }
    
    // 避免请求过于频繁
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * 示例 4: 错误处理
 */
async function errorHandlingExample() {
  console.log('\n=== 错误处理示例 ===');
  
  const testCases = [
    { phoneNumber: '', description: '空手机号码' },
    { phoneNumber: '123', description: '号码太短' },
    { phoneNumber: '12345678901234567890', description: '号码太长' },
    { phoneNumber: 'abcdefghijk', description: '无效字符' },
  ];

  for (const testCase of testCases) {
    try {
      console.log(`\n🧪 测试: ${testCase.description}`);
      
      const response = await axios.post(`${BASE_URL}/account/loginByPhone`, {
        phoneNumber: testCase.phoneNumber,
        defaultCountryCode: '86'
      });

      console.log('   ⚠️  意外成功:', response.data);
    } catch (error) {
      console.log(`   ✅ 正确捕获错误: ${error.response?.data?.message || error.message}`);
    }
  }
}

/**
 * 完整使用流程示例
 */
async function completeWorkflowExample() {
  console.log('\n=== 完整使用流程示例 ===');
  
  try {
    // 步骤 1: 发起登录
    console.log('1️⃣ 发起手机号码登录...');
    const loginResponse = await axios.post(`${BASE_URL}/account/loginByPhone`, {
      phoneNumber: '8613800138000',
      defaultCountryCode: '86'
    });

    if (loginResponse.data.success) {
      const { accountId, phoneNumber, pairingCode } = loginResponse.data;
      
      console.log(`✅ 配对码生成成功: ${pairingCode}`);
      console.log(`📋 账户ID: ${accountId}`);
      
      // 步骤 2: 提示用户操作
      console.log('\n2️⃣ 请在您的手机上完成以下操作:');
      loginResponse.data.instructions.forEach(instruction => {
        console.log(`   ${instruction}`);
      });
      
      // 步骤 3: 等待连接（实际应用中可以通过 webhook 或轮询检查状态）
      console.log('\n3️⃣ 等待用户完成配对...');
      console.log('   （在实际应用中，您可以通过 callbackUrl 接收连接成功通知）');
      
      // 步骤 4: 检查账户状态（模拟）
      console.log('\n4️⃣ 检查账户状态...');
      // 这里可以添加账户状态检查的代码
      
    } else {
      console.log('❌ 登录失败:', loginResponse.data.message);
    }
    
  } catch (error) {
    console.error('❌ 流程执行失败:', error.response?.data || error.message);
  }
}

/**
 * 运行所有示例
 */
async function runAllExamples() {
  console.log('🚀 WhatsApp 手机号码登录示例集合\n');
  
  // 运行各个示例
  await basicPhoneLogin();
  await phoneLoginWithProxy();
  await phoneFormatExamples();
  await errorHandlingExample();
  await completeWorkflowExample();
  
  console.log('\n✨ 所有示例执行完成！');
  console.log('\n📚 更多信息请参考:');
  console.log('   - Baileys 文档: https://baileys.wiki/docs/socket/connecting');
  console.log('   - 项目文档: README.md');
}

// 如果直接运行此文件，则执行所有示例
if (require.main === module) {
  runAllExamples().catch(console.error);
}

module.exports = {
  basicPhoneLogin,
  phoneLoginWithProxy,
  phoneFormatExamples,
  errorHandlingExample,
  completeWorkflowExample,
  runAllExamples
}; 