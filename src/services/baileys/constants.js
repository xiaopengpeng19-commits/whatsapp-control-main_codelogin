const { NodeCache } = require("@cacheable/node-cache");

const LOGIN_STATUS = {
  WAITING_QR: "waiting_qr",
  WAITING_PAIR_CODE: "waiting_pair",
  CONNECTING: "connecting",
  CONNECTED: "normal",
  FAILED: "failed",
  EXPIRED: "expired",
  BANNED: "banned",
};

// ★ 强制限制缓存大小，绝不允许无限增长
const groupCache = new NodeCache({ 
  stdTTL: 5 * 60, 
  checkperiod: 60,
  useClones: false,
  maxKeys: 5000 
});

const msgRetryCounterCache = new NodeCache({ 
  stdTTL: 5 * 60, 
  checkperiod: 60,
  maxKeys: 10000 
});

module.exports = {
  LOGIN_STATUS,
  groupCache,
  msgRetryCounterCache,
};