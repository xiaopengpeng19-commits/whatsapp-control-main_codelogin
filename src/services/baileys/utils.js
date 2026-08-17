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

module.exports = {
  isJidNewsletter,
  extractMessageContent,
  getSessionDir,
  createProxyAgent,
  createBaileysLogger,
  cleanupSession,
};
