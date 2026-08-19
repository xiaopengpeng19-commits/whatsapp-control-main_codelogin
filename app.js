// app.js
console.log("🚀 [1] app.js 开始加载");

require("dotenv").config();
console.log("🚀 [2] dotenv 加载完成");

const Koa = require("koa");
console.log("🚀 [3] Koa 加载完成");

const Router = require("koa-router");
console.log("🚀 [4] Router 加载完成");

const bodyParser = require("koa-bodyparser");
console.log("🚀 [5] bodyParser 加载完成");

const { koaSwagger } = require("koa2-swagger-ui");
console.log("🚀 [6] koaSwagger 加载完成");

const swaggerSpec = require("./src/config/swagger");
console.log("🚀 [7] swaggerSpec 加载完成");

const { createServer } = require("http");
console.log("🚀 [8] createServer 加载完成");

const serve = require("koa-static");
console.log("🚀 [9] serve 加载完成");

const path = require("path");
console.log("🚀 [10] path 加载完成");

const { getModule } = require("./src/utils/logger");
console.log("🚀 [11] logger 加载完成");
const logger = getModule("app");
logger.info("🚀 app.js 开始加载");

console.log("🚀 [12] 加载 natsConfig...");
const natsConfig = require("./src/config/nats");
console.log("🚀 [13] natsConfig 加载完成");

console.log("🚀 [14] 加载 errorHandler...");
const errorHandler = require("./src/middleware/errorHandler");
console.log("🚀 [15] errorHandler 加载完成");

console.log("🚀 [16] 加载 responseFormatter...");
const responseFormatter = require("./src/middleware/responseFormatter");
console.log("🚀 [17] responseFormatter 加载完成");

console.log("🚀 [18] 加载 sendRestartNotification...");
const { sendRestartNotification } = require("./src/services/baileys/connect");
console.log("🚀 [19] sendRestartNotification 加载完成");

console.log("🚀 [20] 加载 routes...");
const accountRoutes = require("./src/routes/account");
console.log("🚀 [21] accountRoutes 加载完成");
const contactRoutes = require("./src/routes/contact");
console.log("🚀 [22] contactRoutes 加载完成");
const groupRoutes = require("./src/routes/group");
console.log("🚀 [23] groupRoutes 加载完成");
const messageRoutes = require("./src/routes/message");
console.log("🚀 [24] messageRoutes 加载完成");
const chatRoutes = require("./src/routes/chat");
console.log("🚀 [25] chatRoutes 加载完成");

console.log("🚀 [26] 创建 Koa 实例...");
const app = new Koa();
console.log("🚀 [27] Koa 实例创建完成");

console.log("🚀 [28] 创建 Router 实例...");
const router = new Router();
console.log("🚀 [29] Router 实例创建完成");

console.log("🚀 [30] 连接 NATS...");
natsConfig.connectNats().then((nc) => {
  if (nc) {
    console.log("🚀 [31] NATS 连接成功");
    logger.info("NATS connection established");
  } else {
    console.log("🚀 [31] NATS 连接失败");
    logger.warn("Failed to establish NATS connection");
  }
});
console.log("🚀 [32] NATS 连接调用完成（异步）");

console.log("🚀 [33] 注册中间件...");
app.use(bodyParser());
console.log("🚀 [34] bodyParser 注册完成");
app.use(errorHandler);
console.log("🚀 [35] errorHandler 注册完成");

console.log("🚀 [36] 注册 Swagger 路由...");
router.get("/swagger.json", (ctx) => {
  ctx.type = "application/json";
  ctx.body = swaggerSpec;
});
console.log("🚀 [37] Swagger 路由注册完成");

console.log("🚀 [38] 注册业务路由...");
router.use("/api/accounts", accountRoutes.routes());
console.log("🚀 [39] /api/accounts 注册完成");
router.use("/api/contacts", contactRoutes.routes());
console.log("🚀 [40] /api/contacts 注册完成");
router.use("/api/groups", groupRoutes.routes());
console.log("🚀 [41] /api/groups 注册完成");
router.use("/api/messages", messageRoutes.routes());
console.log("🚀 [42] /api/messages 注册完成");
router.use("/api/chats", chatRoutes.routes());
console.log("🚀 [43] /api/chats 注册完成");

console.log("🚀 [44] 注册根路由...");
router.get("/", (ctx) => {
  ctx.body = {
    success: true,
    message: "WhatsApp Control System API",
    version: "1.0.0",
    documentation: "/api-docs",
  };
});
console.log("🚀 [45] 根路由注册完成");

console.log("🚀 [46] 应用 router 中间件...");
app.use(router.routes()).use(router.allowedMethods());
console.log("🚀 [47] router 中间件应用完成");

console.log("🚀 [48] 注册 responseFormatter...");
app.use(responseFormatter);
console.log("🚀 [49] responseFormatter 注册完成");

console.log("🚀 [50] 注册 Swagger UI...");
app.use(
  koaSwagger({
    routePrefix: "/api-docs",
    swaggerOptions: {
      url: "/swagger.json",
      docExpansion: "none",
      defaultModelsExpandDepth: 0,
      operationsSorter: "alpha",
    },
    hideTopbar: false,
    title: "WhatsApp API Documentation",
    exposeSpec: true,
    specPrefix: "/swagger.json",
  }),
);
console.log("🚀 [51] Swagger UI 注册完成");

console.log("🚀 [52] 创建 HTTP 服务器...");
const server = createServer(app.callback());
console.log("🚀 [53] HTTP 服务器创建完成");

console.log("🚀 [54] 加载 baileysConnect...");
const baileysConnect = require("./src/services/baileys/connect");
console.log("🚀 [55] baileysConnect 加载完成");

console.log("🚀 [56] 启动服务器...");
const CHECK_INTERVAL_MINUTES = parseInt(process.env.CHECK_INTERVAL_MINUTES) || 5;
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 [57] 服务器启动完成，端口: ${PORT}`);
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Swagger API documentation available at http://localhost:${PORT}/api-docs`);

  // Set up interval to check and disconnect idle connections every 15 minutes
  console.log("🚀 [58] 设置空闲连接检查器...");

  setInterval(
    async () => {
      try {
        await baileysConnect.intervalStopIdelConnection();
      } catch (error) {
        logger.error("Error checking idle connections:", error);
      }
    },
    CHECK_INTERVAL_MINUTES * 60 * 1000,
  );
  logger.info(`🔄 空闲连接检查已启动 (间隔: ${CHECK_INTERVAL_MINUTES}分钟)`);

  // 发送重启通知
  console.log("🚀 [60] 发送重启通知...");
  setTimeout(() => {
    sendRestartNotification().catch(console.error);
  }, 2000);
  console.log("🚀 [61] 重启通知已发送");

  console.log("🚀 [62] 空闲连接检查器已初始化");
  logger.info("Idle connection checker initialized");
});

console.log("🚀 [63] 注册进程信号处理...");
// Handle application shutdown to gracefully close connections
process.on("SIGINT", async () => {
  console.log("🚀 [64] 收到 SIGINT，正在关闭...");
  logger.info("Application shutting down...");

  // Close NATS connection
  await natsConfig.closeConnection();

  process.exit(0);
});
console.log("🚀 [65] SIGINT 处理注册完成");

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.log("🚀 [66] 捕获未处理异常:", err.message);
  logger.error("================ UNCAUGHT EXCEPTION ================");
  logger.error(err.message);
  logger.error(err.stack);
  logger.error("====================================================");
});

process.on("unhandledRejection", (reason, promise) => {
  console.log("🚀 [67] 捕获未处理拒绝:", reason);
  logger.error("================ UNHANDLED REJECTION ================");
  logger.error("Reason:", reason);
  logger.error("Promise:", promise);
  logger.error("=====================================================");
});

console.log("🚀 [68] app.js 加载完成（等待服务器启动）");

module.exports = server;
