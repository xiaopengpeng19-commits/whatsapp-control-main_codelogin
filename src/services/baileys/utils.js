// src/services/baileys/utils.js
const fs = require('fs');
const path = require('path');
const P = require('pino');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { getContentType } = require('@whiskeysockets/baileys');

function isJidNewsletter(jid) {
  return jid && jid.includes('@newsletter');
}

function extractMessageContent(message) {
  if (!message) return '';
  const type = getContentType(message);
  const msg = message[type];
  if (!msg) return '';
  if (typeof msg === 'string') return msg;
  return msg.caption || msg.text || msg.conversation || msg.displayName || msg.name || msg.title || '';
}

function getSessionDir(accountId) {
  const dir = path.join('./storage/sessions', String(accountId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createProxyAgent(proxy) {
  if (!proxy) return null;
  try {
    return new SocksProxyAgent(proxy);
  } catch (error) {
    return null;
  }
}

function createBaileysLogger() {
  const logger = P({
    level: process.env.BAILEYS_LOG_LEVEL || 'warn',
    transport: {
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          level: 'warn',  // 这里也改成 warn
        },
        { target: 'pino/file', options: { destination: './wa-logs.txt' }, level: 'warn' },
      ],
    },
  });
  
  // ==========================================
  // 添加 trace 方法（空实现），让 Baileys 不报错
  // 但实际不输出 trace 日志
  // ==========================================
  if (!logger.trace) {
    logger.trace = () => {};  // 空函数，不输出任何日志
  }
  
  return logger;
}

function cleanupSession(accountId) {
  try {
    const sessionDir = `./storage/sessions/${accountId}`;
    if (fs.existsSync(sessionDir)) {
      const files = fs.readdirSync(sessionDir);
      if (files.length === 0) {
        fs.rmdirSync(sessionDir);
        return true;
      }
    }
  } catch (error) {}
  return false;
}

module.exports = {
  isJidNewsletter,
  extractMessageContent,
  getSessionDir,
  createProxyAgent,
  createBaileysLogger,
  cleanupSession,
};