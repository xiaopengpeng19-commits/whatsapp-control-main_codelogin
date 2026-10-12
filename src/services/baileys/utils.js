// src/services/baileys/utils.js
const fs = require("fs");
const path = require("path");
const P = require("pino");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { getContentType } = require("@whiskeysockets/baileys");

function isJidNewsletter(jid) {
  return jid && jid.includes("@newsletter");
}

function extractMessageContent(message) {
  if (!message) return "";
  const type = getContentType(message);
  const msg = message[type];
  if (!msg) return "";
  if (typeof msg === "string") return msg;
  return msg.caption || msg.text || msg.conversation || msg.displayName || msg.name || msg.title || "";
}

function getSessionDir(accountId) {
  const dir = path.join("./storage/sessions", String(accountId));
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
    level: process.env.BAILEYS_LOG_LEVEL || "error",
    transport: {
      targets: [
        {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
          level: "warn",
        },
        { target: "pino/file", options: { destination: "./wa-logs.txt" }, level: "warn" },
      ],
    },
  });

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

// ==========================================
// 统一释放 sock：关连接 + 切引用环 + 清 listener
// 幂等：同一 sock 多次调用只执行一次
// ==========================================
async function releaseSock(sock, reason = "") {
  if (!sock) return;
  if (sock._released) return;
  sock._released = true;

  try {
    sock._manualClose = true;
  } catch (e) {}

  // 1. 关闭底层连接
  try {
    if (typeof sock.end === "function") {
      await sock.end().catch(() => {});
    }
  } catch (e) {}

  // 2. 切断 EventEmitter 上挂的所有 listener
  try {
    if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
      sock.ev.removeAllListeners();
    }
    if (typeof sock.removeAllListeners === "function") {
      sock.removeAllListeners();
    }
  } catch (e) {}

  // 3. 清掉大对象引用
  try {
    sock.user = null;
    sock.auth = null;
    sock.store = null;
    sock._closed = true;
    sock._closeHandled = true;
  } catch (e) {}
}

function releaseSockSync(sock, reason = "") {
  if (!sock) return;
  releaseSock(sock, reason).catch(() => {});
}

module.exports = {
  isJidNewsletter,
  extractMessageContent,
  getSessionDir,
  createProxyAgent,
  createBaileysLogger,
  cleanupSession,
  releaseSock,
  releaseSockSync,
};
