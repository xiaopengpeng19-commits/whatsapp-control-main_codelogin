/**
 * WhatsApp 手机号码登录测试
 * 
 * 使用方法:
 * 1. 确保服务器正在运行: npm start
 * 2. 运行测试: node test_phone_login.js
 * 3. 按照控制台提示在手机上输入配对码
 */

const axios = require('axios');
const readline = require('readline');

// 配置
const SERVER_URL = 'http://localhost:8080/api';
const TEST_PHONE = '8618939797045'; // 请替换为您的实际手机号码

// 创建读取用户输入的接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * 提示用户输入
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * 主测试函数
 */
async function testPhoneLogin() {
  try {
    console.log('🚀 开始 WhatsApp 手机号码登录测试');
    console.log('=====================================\n');

    // 获取用户输入的手机号码
    // const phoneNumber = await askQuestion(`请输入您的手机号码 (默认: ${TEST_PHONE}): `);
    // const finalPhone = phoneNumber.trim() || TEST_PHONE;
    const finalPhone =TEST_PHONE;

    console.log(`\n📱 使用手机号码: ${finalPhone}`);
    
    // 询问是否使用代理
    // const useProxy = await askQuestion('是否使用代理? (y/N): ');
    let proxy = null;
    proxy = 'socks5://xxxxx:xxxxx@xxxxxx:1111' //配置代理
    
    // if (useProxy.toLowerCase() === 'y' || useProxy.toLowerCase() === 'yes') {
    //   proxy = await askQuestion('请输入代理地址 (例如: socks5://127.0.0.1:1080): ');
    // }

    // 构建请求数据
    const requestData = {
      phoneNumber: finalPhone,
      defaultCountryCode: '86'  // 默认中国
    };

    if (proxy) {
      requestData.proxy = proxy;
      console.log(`🌐 使用代理: ${proxy}`);
    }

    console.log('\n⏳ 正在发送登录请求...');

    // 发送登录请求
    const response = await axios.post(`${SERVER_URL}/accounts/loginByPhone`, requestData);

    if (response.data.success) {
      console.log('\n✅ 配对码生成成功！');
      console.log('=====================================');
      console.log(`📱 手机号码: ${response.data.phoneNumber}`);
      console.log(`🆔 账户ID: ${response.data.accountId}`);
      console.log(`🔢 配对码: ${response.data.pairingCode}`);
      console.log('=====================================\n');


      console.log('\n⚠️  重要提示:');
      console.log('   - 请确保您的手机可以接收 WhatsApp 消息');
      console.log('   - 配对码有时效性，请尽快完成操作');
      console.log('   - 如果配对失败，可以重新运行此测试');


    } else {
      console.log('\n❌ 登录失败:', response.data.message);
    }

  } catch (error) {
    console.error('\n❌ 测试失败:');
    
    if (error.response) {
      // 服务器返回错误响应
      console.error('   状态码:', error.response.status);
      console.error('   错误信息:', error.response.data.message || error.response.data);
    } else if (error.request) {
      // 请求发送失败
      console.error('   无法连接到服务器，请确保服务器正在运行');
      console.error('   服务器地址:', SERVER_URL);
    } else {
      // 其他错误
      console.error('   ', error.message);
    }
    
    console.log('\n🔧 故障排除建议:');
    console.log('   1. 检查服务器是否正在运行: npm start');
    console.log('   2. 确认服务器地址正确:', SERVER_URL);
    console.log('   3. 检查手机号码格式是否正确');
    console.log('   4. 如果使用代理，请确认代理设置正确');
  } finally {
    rl.close();
  }
}

/**
 * 显示使用说明
 */
function showUsage() {
  console.log('📚 WhatsApp 手机号码登录测试说明');
  console.log('=====================================');
  console.log('');
  console.log('此测试程序将帮助您通过手机号码登录 WhatsApp。');
  console.log('');
  console.log('📋 前提条件:');
  console.log('   ✓ 服务器正在运行 (npm start)');
  console.log('   ✓ 手机安装了 WhatsApp 应用');
  console.log('   ✓ 手机号码已注册 WhatsApp');
  console.log('');
  console.log('🔄 测试流程:');
  console.log('   1. 输入手机号码');
  console.log('   2. 选择是否使用代理');
  console.log('   3. 获取配对码');
  console.log('   4. 在手机 WhatsApp 中输入配对码');
  console.log('   5. 完成连接');
  console.log('');
  console.log('📱 支持的手机号码格式:');
  console.log('   - 8613800138000 (中国格式)');
  console.log('   - +86 138 0013 8000 (带国家代码)');
  console.log('   - 86-138-0013-8000 (带连字符)');
  console.log('   - +1 (234) 567-8901 (美国格式)');
  console.log('');
}

// 主程序入口
async function main() {
  console.clear(); // 清屏
  
  showUsage();
  
  // const startTest = await askQuestion('🚀 是否开始测试? (Y/n): ');
  
  // if (startTest.toLowerCase() === 'n' || startTest.toLowerCase() === 'no') {
  //   console.log('👋 测试已取消');
  //   rl.close();
  //   return;
  // }

  await testPhoneLogin();
}

// 运行主程序
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testPhoneLogin
}; 