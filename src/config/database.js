const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Configure the database connection
const sequelize = new Sequelize({
  database: process.env.DB_NAME || 'whatsapp',
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'password8977',
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  // Print detailed SQL in development mode
  logging: process.env.NODE_ENV === 'development' ? 
    (query, timing) => {
      console.log(`\n[SQL] (${timing}ms) ${query}\n`);
    } : false,
  define: {
    timestamps: true,
    underscored: false
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

/**
 * Connect to the database
 */
async function connect() {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established successfully');

    // Sync models with database if needed
    if (process.env.NODE_ENV !== 'production' && process.env.DB_SYNC === 'true') {
      await sequelize.sync({ alter: true });
      logger.info('Database models synchronized');
    }
  } catch (error) {
    console.log(error)
    logger.error('Unable to connect to the database:', error);
    // Don't exit process to allow server to start without DB in development
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

module.exports = {
  sequelize,
  connect
};