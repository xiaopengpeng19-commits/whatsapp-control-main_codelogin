// src/services/baileys/constants.js
const { NodeCache } = require('@cacheable/node-cache');

const LOGIN_STATUS = {
  WAITING_QR: 'waiting_qr',
  WAITING_PAIR_CODE: 'waiting_pair',
  CONNECTING: 'connecting',
  CONNECTED: 'normal',
  FAILED: 'failed',
  EXPIRED: 'expired',
  BANNED: 'banned'
};

const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });
const msgRetryCounterCache = new NodeCache();

module.exports = {
  LOGIN_STATUS,
  groupCache,
  msgRetryCounterCache,
};