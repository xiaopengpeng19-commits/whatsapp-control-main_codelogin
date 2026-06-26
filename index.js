import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { fileURLToPath } from 'url';
import path from 'path';

import pkg from 'malvin-btns';
const { sendButtons } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHONE_NUMBER = process.env.PHONE_NUMBER || '';
const PROXY_URL = process.env.PROXY_URL || '';

// ============================================
//  malvin-btns + 图片（只保留 cta_url）
// ============================================

async function sendReply(sock, jid, senderName, text) {
    const imageUrl = 'https://www.baidu.com/img/PCtm_d9c8750bed0b3c7d089fa7d55720d6cf.png';

    try {
        await sendButtons(sock, jid, {
            title: '自动回复',
            text: '你好 ' + senderName + '！\n\n你发送的消息是：\n"' + text + '"',
            image: { url: imageUrl },
            footer: '点击按钮访问',
            buttons: [
                {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '访问百度',
                        url: 'https://www.baidu.com'
                    })
                }
            ]
        });
        console.log('   回复: malvin-btns + 图片（仅链接按钮）');
        return;
    } catch (error) {
        console.log('[malvin-btns 失败]', error.message);
    }

    // 降级
    await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: '你好 ' + senderName + '！\n\n你发送的消息是：\n"' + text + '"\n\n访问百度：https://www.baidu.com'
    });
    console.log('   回复: 图片 + 文字（降级）');
}

// ============================================
//  主程序
// ============================================

async function startSock() {
    console.log('\n========================================');
    console.log('  WhatsApp Bot (malvin-btns)');
    console.log('  手机号: ' + PHONE_NUMBER);
    console.log('========================================\n');

    try {
        const { version } = await fetchLatestBaileysVersion();
        console.log('[+] 使用版本:', version.join('.'));

        const { state, saveCreds } = await useMultiFileAuthState(
            path.join(__dirname, 'auth_info')
        );

        const agent = new SocksProxyAgent(PROXY_URL);

        const sock = makeWASocket({
            version: version,
            auth: state,
            browser: Browsers.macOS('Google Chrome'),
            agent: agent,
            connectTimeoutMs: 60000,
            printQRInTerminal: false,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('二维码已生成');
                if (!sock.authState.creds.registered) {
                    try {
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        console.log('配对码:', code);
                    } catch (error) {
                        console.log('配对码失败，请扫码');
                    }
                }
            }

            if (connection === 'open') {
                console.log('\n✅ 连接成功！');
                console.log('malvin-btns 已启动\n');
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                console.log('断开, 状态码:', statusCode);
                if (statusCode !== DisconnectReason.loggedOut) {
                    setTimeout(startSock, 5000);
                }
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg || msg.key.fromMe) return;

                const senderJid = msg.key.remoteJidAlt || msg.key.remoteJid;
                const senderNumber = senderJid.split('@')[0];
                const senderName = msg.pushName || '未知用户';
                const text = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text || '';

                console.log('\n📩 收到消息');
                console.log('   发送者:', senderNumber);
                console.log('   名称:', senderName);
                console.log('   内容:', text || '(非文本消息)');

                await sock.readMessages([msg.key]);

                if (text) {
                    await sendReply(sock, senderJid, senderName, text);
                }
            } catch (error) {
                console.log('消息处理错误:', error.message);
            }
        });

        console.log('等待消息...\n');
        return sock;
    } catch (error) {
        console.error('启动失败:', error.message);
        setTimeout(startSock, 5000);
    }
}

startSock();

process.on('SIGINT', () => {
    console.log('\n退出');
    process.exit(0);
});
