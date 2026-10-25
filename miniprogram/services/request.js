const config = require('../config');
const { getUserId, ownershipBlock } = require('../utils/ownership');

function assertExpectedOwner(expectedOwnerUserId) {
  if (!expectedOwnerUserId) return;
  const currentUserId = getUserId(wx.getStorageSync('mind_trace_user'));
  const block = ownershipBlock({ ownerUserId: expectedOwnerUserId }, currentUserId);
  if (block) {
    const error = new Error(block.message);
    error.accountChanged = block.reason === 'accountChanged';
    error.blockReason = block.reason;
    throw error;
  }
}

function rawRequest(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('mind_trace_token');
    wx.request({
      url: `${config.API_BASE}${options.path}`,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: config.REQUEST_TIMEOUT,
      header: Object.assign({
        'Content-Type': 'application/json'
      }, token && options.auth !== false ? { Authorization: `Bearer ${token}` } : {}, options.header || {}),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data && Object.prototype.hasOwnProperty.call(res.data, 'data') ? res.data.data : res.data);
          return;
        }
        const error = new Error(res.data && res.data.error && res.data.error.message
          ? res.data.error.message : `请求未完成（${res.statusCode}）`);
        error.statusCode = res.statusCode;
        error.code = res.data && res.data.error && res.data.error.code;
        reject(error);
      },
      fail: (err) => {
        const error = new Error('网络连接失败，请稍后重试');
        error.network = true;
        error.originalError = err;
        reject(error);
      }
    });
  });
}

async function request(options) {
  const requestOwnerUserId = options.expectedOwnerUserId || getUserId(wx.getStorageSync('mind_trace_user'));
  assertExpectedOwner(requestOwnerUserId);
  try {
    return await rawRequest(options);
  } catch (error) {
    if (error.statusCode === 401 && options.auth !== false && !options.retried) {
      const auth = require('./auth');
      await auth.ensureLogin(true);
      // 所有旧请求都禁止在内部用户变化后重放；队列还使用不可变的 ownerUserId。
      assertExpectedOwner(requestOwnerUserId);
      return rawRequest(Object.assign({}, options, { retried: true }));
    }
    throw error;
  }
}

module.exports = request;
module.exports.raw = rawRequest;
