// src/utils/logger.js
const pino = require("pino");
const fs = require("fs");
const path = require("path");

// ========== 日志目录 ==========
const LOG_DIR = "./logs";
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ========== 清理7天前的日志 ==========
const cleanOldLogs = () => {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith("app-") || !file.endsWith(".log")) continue;
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > sevenDays) {
        fs.unlinkSync(filePath);
        console.log(`[logger] 已删除过期日志: ${file}`);
      }
    }
  } catch (error) {
    // 清理失败不影响主流程
  }
};

// ========== 生成按日期命名的日志文件 ==========
const getLogFileName = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return path.join(LOG_DIR, `app-${year}-${month}-${day}.log`);
};

// ========== 启动时清理旧日志 ==========
cleanOldLogs();

// ========== 日志配置 ==========
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const baseLogger = pino({
  level: LOG_LEVEL,
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          messageFormat: "[{module}] {msg}",
          destination: getLogFileName(),
          mkdir: true,
        },
        level: "info",
      },
    ],
  },
});

// ========== 模块工厂 ==========
function createModuleLogger(moduleName) {
  const child = baseLogger.child({ module: moduleName });
  let context = {};

  return {
    setContext: (ctx) => {
      context = { ...context, ...ctx };
      return this;
    },
    clearContext: () => {
      context = {};
      return this;
    },
    withAccount: (accountId, phoneNumber) => {
      return createModuleLogger(moduleName).setContext({ accountId, phoneNumber });
    },

    debug: (msg, data) => {
      child.debug({ ...context, ...(data ? { data } : {}) }, msg);
    },
    info: (msg, data) => {
      child.info({ ...context, ...(data ? { data } : {}) }, msg);
    },
    warn: (msg, data) => {
      child.warn({ ...context, ...(data ? { data } : {}) }, msg);
    },
    error: (msg, err, data) => {
      let errorInfo = null;
      if (err instanceof Error) {
        errorInfo = {
          message: err.message,
          stack: err.stack,
          code: err.code || err.statusCode || err.status,
          name: err.name,
        };
      } else if (err) {
        errorInfo = typeof err === "string" ? { message: err } : err;
      }
      child.error(
        {
          ...context,
          ...(errorInfo ? { error: errorInfo } : {}),
          ...(data ? { data } : {}),
        },
        msg,
      );
    },
    getContext: () => ({ ...context }),
  };
}

// ========== 导出 ==========
module.exports = {
  conn: createModuleLogger("conn"),
  nats: createModuleLogger("nats"),
  redis: createModuleLogger("redis"),
  msg: createModuleLogger("msg"),
  auth: createModuleLogger("auth"),
  group: createModuleLogger("group"),
  getModule: createModuleLogger,
  setLevel: (level) => {
    baseLogger.level = level;
  },
  getLevel: () => baseLogger.level,
};
