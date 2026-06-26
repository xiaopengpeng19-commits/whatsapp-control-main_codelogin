const pino = require('pino');

const loggerOptions = {
  // level: process.env.LOG_LEVEL || 'info',
  level: 'trace',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
};

// Create the logger account
const logger = pino(loggerOptions);

module.exports = logger; 