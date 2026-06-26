const Redis = require('redis');
const logger = require('../utils/logger');

let client;

/**
 * Connect to Redis
 */
async function connect() {
  try {
    if (!client) {
      client = Redis.createClient({
        url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
        password: process.env.REDIS_PASSWORD,
      });

      client.on('error', (err) => {
        logger.error('Redis error:', err);
      });

      client.on('connect', () => {
        logger.info('Connected to Redis');
      });

      await client.connect();
    }
    return client;
  } catch (error) {
    logger.error('Redis connection error:', error);
    throw error;
  }
}

/**
 * Get Redis client
 * @returns {Redis} Redis client
 */
function getClient() {
  if (!client) {
    throw new Error('Redis client not initialized. Call connect() first.');
  }
  return client;
}

// Initialize client on module load
connect().catch(error => {
  logger.error('Failed to initialize Redis:', error);
  process.exit(1);
});

module.exports = {
  connect,
  getClient
}; 