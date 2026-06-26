require('dotenv').config();
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const { koaSwagger } = require('koa2-swagger-ui');
const swaggerSpec = require('./src/config/swagger');
const { createServer } = require('http');
const serve = require('koa-static');
const path = require('path');

const logger = require('./src/utils/logger');
const natsConfig = require('./src/config/nats');

const errorHandler = require('./src/middleware/errorHandler');
const responseFormatter = require('./src/middleware/responseFormatter');

// Import routes
const accountRoutes = require('./src/routes/account');
const contactRoutes = require('./src/routes/contact');
const groupRoutes = require('./src/routes/group');
const messageRoutes = require('./src/routes/message');
const chatRoutes = require('./src/routes/chat');
const app = new Koa();
const router = new Router();

// Connect to NATS
natsConfig.connectNats().then(nc => {
  if (nc) {
    logger.info('NATS connection established');
  } else {
    logger.warn('Failed to establish NATS connection');
  }
});

// Basic middlewares
app.use(bodyParser());
app.use(errorHandler);

// Swagger endpoint
router.get('/swagger.json', ctx => {
  ctx.type = 'application/json';
  ctx.body = swaggerSpec;
});

// Routes
router.use('/api/accounts', accountRoutes.routes());


router.use('/api/contacts', contactRoutes.routes());
router.use('/api/groups', groupRoutes.routes());
router.use('/api/messages', messageRoutes.routes());
router.use('/api/chats', chatRoutes.routes());
// Add a root route
router.get('/', ctx => {
  ctx.body = {
    success: true,
    message: 'WhatsApp Control System API',
    version: '1.0.0',
    documentation: '/api-docs'
  };
});

// Apply router middleware
app.use(router.routes()).use(router.allowedMethods());

// Add formatter middleware after routes (so it doesn't affect Swagger UI)
app.use(responseFormatter);

// Apply Swagger UI middleware last
app.use(
  koaSwagger({
    routePrefix: '/api-docs', // host at /api-docs
    swaggerOptions: {
      url: '/swagger.json', // example path to json
      docExpansion: 'none',
      defaultModelsExpandDepth: 0,
      operationsSorter: 'alpha'
    },
    hideTopbar: false,
    title: 'WhatsApp API Documentation',
    exposeSpec: true,
    specPrefix: '/swagger.json'
  }),
);

// Start the server
const server = createServer(app.callback());

// Import the connection service
const baileysConnect = require('./src/services/baileys/connect');

server.listen(process.env.PORT || 8080, () => {
  logger.info(`Server running on port ${process.env.PORT || 8080}`);
  logger.info(`Swagger API documentation available at http://localhost:${process.env.PORT || 8080}/api-docs`);
  
  // Set up interval to check and disconnect idle connections every 15 minutes
  setInterval(async () => {
    try {
      await baileysConnect.intervalStopIdelConnection();
    } catch (error) {
      logger.error('Error checking idle connections:', error);
    }
  }, 15 * 60 * 1000);
  
  logger.info('Idle connection checker initialized');
});

// Handle application shutdown to gracefully close connections
process.on('SIGINT', async () => {
  logger.info('Application shutting down...');
  
  // Close NATS connection
  await natsConfig.closeConnection();
  
  // Other cleanup code
  
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('================ UNCAUGHT EXCEPTION ================');
  console.error(err.message);
  console.error(err.stack);
  console.error('====================================================');
  logger.error('Uncaught Exception:', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('================ UNHANDLED REJECTION ================');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('=====================================================');
  logger.error('Unhandled Rejection:', { reason: reason?.message || String(reason) });
});

module.exports = server; 