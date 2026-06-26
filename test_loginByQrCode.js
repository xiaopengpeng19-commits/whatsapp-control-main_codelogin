/**
 * 测试 loginByQrCode 接口
 * 运行：node test_loginByQrCode.js
 */

const axios = require('axios');
const readline = require('readline');

// 你的服务地址和端口
const BASE_URL = 'http://localhost:8080/api/accounts/loginByQrCode';

async function testLoginByQrCode() {
  try {
    // 交互式输入是否需要代理
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    const ask = (q) => new Promise(res => rl.question(q, res));
    // const useProxy = await ask('是否需要代理？(y/N): ');
    let requestBody = {};
    // if (useProxy.trim().toLowerCase() === 'y') {
      // const proxy = await ask('请输入 socks5 代理地址（如 socks5://127.0.0.1:1080）：');
      //  requestBody.proxy = proxy.trim();
      requestBody.proxy = 'socks5://plu17893-zone-custom-region-co-session-573244694296-sessTime-10:rkdjkb@ar.proxylink.net:1111';
      requestBody.callbackurl = 'http://127.0.0.1:9999/api/accountcallback';
    // }
    rl.close();

    const response = await axios.post(BASE_URL, requestBody, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data.status === 200) {
      console.log('✅ 获取二维码成功！');
      console.log('账户ID:', response.data.accountId);
      console.log('二维码内容（请用二维码生成工具转为图片扫码登录）:');
      console.log(response.data.data);
    } else {
      console.log('❌ 获取二维码失败:', response.data);
    }
  } catch (error) {
    if (error.response) {
      console.error('❌ 请求失败:', error.response.data);
    } else {
      console.error('❌ 网络或其他错误:', error.message);
    }
  }
}

testLoginByQrCode(); 