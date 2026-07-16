// src/utils/logger.js
const pino = require('pino');

// ========== 敏感信息脱敏 ==========
function sanitize(obj) {
  if (typeof obj === 'string') {
    let result = obj.replace(/(socks5|http|https):\/\/([^:]+):([^@]+)@/g, '$1://***:***@');
    result = result.replace(/\b(\d{7,})\b/g, '***');
    result = result.replace(/(pass|password|secret|key|token)=["']?([^"'\s]+)/gi, '$1="***"');
    return result;
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = Array.isArray(obj) ? [] : {};
    const sensitiveKeys = ['password', 'pass', 'secret', 'token', 'credential', 'apiKey'];
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        sanitized[key] = '***';
      } else if (key === 'proxy' && typeof value === 'string') {
        sanitized[key] = value.replace(/(:\/\/)([^:]+):([^@]+)@/, '$1***:***@');
      } else if (key === 'phoneNumber' && typeof value === 'string') {
        sanitized[key] = value.replace(/(\d{7,})/, '***');
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
  return obj;
}

// ========== 日志级别 ==========
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// ========== 基础配置 ==========
const baseLogger = pino({
  level: LOG_LEVEL,
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          messageFormat: '[{module}] {msg}',
        },
        level: LOG_LEVEL,
      },
      {
        target: 'pino/file',
        options: { destination: './app.log' },
        level: 'info',
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
      const sanitized = data ? sanitize(data) : undefined;
      child.debug({ ...context, ...(sanitized ? { data: sanitized } : {}) }, msg);
    },
    info: (msg, data) => {
      const sanitized = data ? sanitize(data) : undefined;
      child.info({ ...context, ...(sanitized ? { data: sanitized } : {}) }, msg);
    },
    warn: (msg, data) => {
      const sanitized = data ? sanitize(data) : undefined;
      child.warn({ ...context, ...(sanitized ? { data: sanitized } : {}) }, msg);
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
        errorInfo = typeof err === 'string' ? { message: err } : err;
      }
      const sanitized = data ? sanitize(data) : undefined;
      child.error({
        ...context,
        ...(errorInfo ? { error: errorInfo } : {}),
        ...(sanitized ? { data: sanitized } : {}),
      }, msg);
    },
    getContext: () => ({ ...context }),
  };
}

// ========== 导出模块日志实例 ==========
module.exports = {
  conn: createModuleLogger('conn'),   // 连接管理
  nats: createModuleLogger('nats'),   // NATS
  redis: createModuleLogger('redis'), // Redis
  msg: createModuleLogger('msg'),     // 消息处理
  auth: createModuleLogger('auth'),   // 认证登录
  
  getModule: createModuleLogger,
  setLevel: (level) => { baseLogger.level = level; },
  getLevel: () => baseLogger.level,
};