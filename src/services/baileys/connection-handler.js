// src/services/baileys/connection-handler.js
const { Boom } = require('@hapi/boom');
const { DisconnectReason } = require('@whiskeysockets/baileys');
const { LOGIN_STATUS } = require('./constants');
const { cleanupSession } = require('./utils');
const redisStorage = require('../redisStorage');
const { conn } = require('../../utils/logger');
const logger = conn;

async function updateAccountStatus(accountId, phoneNumber, accountStatus, socketStatus) {
  try {
    const accountData = {
      id: accountId,
      phoneNumber: phoneNumber || null,
      socket_status: socketStatus,
      account_status: accountStatus,
      lastActive: new Date().toISOString()
    };
    const existing = await redisStorage.getAccountById(accountId);
    if (existing) {
      await redisStorage.updateAccount(accountId, accountData);
    } else {
      await redisStorage.upsertAccount(accountData);
    }
  } catch (error) {
    logger.error(`[${accountId}] 更新账号状态失败:`, error);
  }
}

function handlePairCode(sock, account, ctx) {
  const { accountId, resolveFunc, rejectFunc } = ctx;
  const phoneNumber = account.phoneNumber;
  if (!phoneNumber) {
    rejectFunc(new Error('配对码登录需要提供手机号'));
    return;
  }
  sock.requestPairingCode(phoneNumber)
    .then(code => {
      logger.info(`[${accountId}] 配对码生成成功: ${code}`);
      updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_PAIR_CODE, 'disconnected');
      ctx.resolveFunc({ status: 'waiting_pair_code', code, accountId, phoneNumber: account.phoneNumber });
    })
    .catch(err => {
      logger.error(`[${accountId}] 请求配对码失败:`, err);
      sock.account_status = LOGIN_STATUS.FAILED;
      updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.FAILED, 'disconnected');
      ctx.rejectFunc(err);
    });
}

function handleQRCode(sock, account, qr, ctx) {
  const { accountId, resolveFunc } = ctx;
  logger.info(`[${accountId}] QR码已生成`);
  updateAccountStatus(accountId, account.phoneNumber, LOGIN_STATUS.WAITING_QR, 'disconnected');
  resolveFunc({ status: 'waiting_qr', qr, accountId });
}

function handleConnectionClose(sock, account, lastDisconnect, ctx) {
  const { accountId, resolveFunc, rejectFunc, retryCount, usePairCode, onConnected } = ctx;
  const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error?.output?.statusCode : null;
  const isManualClose = sock._manualClose === true;
  
  const shouldReconnect = !isManualClose
    && statusCode !== DisconnectReason.loggedOut 
    && statusCode !== 403 
    && statusCode !== 401
    && lastDisconnect?.error?.message !== 'QR refs attempts ended';

  logger.warn(`[${accountId}] 连接关闭, 状态码: ${statusCode}, 重试: ${shouldReconnect}`);

  if (shouldReconnect && retryCount > 0) {
    logger.info(`[${accountId}] 剩余重试次数: ${retryCount}`);
    const { createConnection } = require('./connect');
    createConnection(account, onConnected, retryCount - 1, usePairCode)
      .then(result => resolveFunc(result))
      .catch(err => rejectFunc(err));
    return;
  }

  const status = statusCode === 403 ? LOGIN_STATUS.BANNED : LOGIN_STATUS.EXPIRED;
  if (statusCode === 403 || statusCode === 401) sock.socket_status = 'disconnected';
  
  updateAccountStatus(accountId, account.phoneNumber, status, sock.socket_status || 'disconnected');
  cleanupSession(accountId);
  ctx.connections.delete(accountId);
  rejectFunc(new Error(`连接失败: ${lastDisconnect?.error?.message || '未知错误'}`));
}

function handleConnectionOpen(sock, account, ctx) {
  const { accountId, resolveFunc, onConnected, connections } = ctx;
  
  sock._manualClose = false;
  
  let phoneNumber = account.phoneNumber;
  if (!phoneNumber && sock.user?.id) {
    const match = sock.user.id.match(/^(\d+)/);
    phoneNumber = match ? match[1] : sock.user.id.split(':')[0]?.split('@')[0];
  }
  account.phoneNumber = phoneNumber;

  sock.account_status = LOGIN_STATUS.CONNECTED;
  sock.lastActiveTime = new Date();

  updateAccountStatus(accountId, phoneNumber, LOGIN_STATUS.CONNECTED, 'connected');
  connections.set(accountId, sock);

  logger.info(`[${accountId}] WhatsApp 连接成功: ${phoneNumber}`);

  if (onConnected) {
    onConnected(sock).catch(err => logger.error(`[${accountId}] 回调执行失败:`, err));
  }

  resolveFunc({ status: 'connected', sock, accountId, phoneNumber: account.phoneNumber });
}

function createConnectionHandler(sock, account, ctx) {
  const { usePairCode } = ctx;
  return (update) => {
    const { connection, lastDisconnect, qr } = update;
    logger.debug(`[${ctx.accountId}] 连接更新:`, update);

    if (qr && usePairCode && !sock.authState.creds.registered) {
      return handlePairCode(sock, account, qr, ctx);
    }
    if (qr && !usePairCode) {
      return handleQRCode(sock, account, qr, ctx);
    }
    if (connection === 'close') {
      return handleConnectionClose(sock, account, lastDisconnect, ctx);
    }
    if (connection === 'open') {
      return handleConnectionOpen(sock, account, ctx);
    }
  };
}

module.exports = {
  updateAccountStatus,
  createConnectionHandler,
};