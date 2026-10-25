const request = require('./request');
const config = require('../config');
const { getUserId } = require('../utils/ownership');
const { normalizeDataMode } = require('../utils/data-mode');

let loginPromise = null;

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => res.code ? resolve(res.code) : reject(new Error('未获得微信登录凭证')),
      fail: () => reject(new Error('微信登录暂时不可用'))
    });
  });
}

function completeLogin(result, requireToken) {
  if (requireToken && (!result || !result.token)) throw new Error('登录响应缺少 token');
  const user = result && result.user ? result.user : result;
  if (!getUserId(user)) throw new Error('登录响应缺少用户内部 ID');
  if (requireToken) wx.setStorageSync('mind_trace_token', result.token);
  else wx.removeStorageSync('mind_trace_token');
  wx.setStorageSync('mind_trace_user', user);
  const app = getApp();
  if (app && app.globalData) app.globalData.user = user;
  // 云登录与 HTTP 重登录都必须先冻结其他账号的离线记录。
  require('./sync').reconcileAccount(user);
  return user;
}

async function cloudAuthenticate(force, cachedUser) {
  let result;
  if (getUserId(cachedUser) && !force) {
    try {
      result = await request.raw({ path: '/me', auth: false });
    } catch (error) {
      if (error.statusCode !== 401) throw error;
      result = await request.raw({ path: '/auth/wechat/login', method: 'POST', auth: false, data: {} });
    }
  } else {
    result = await request.raw({ path: '/auth/wechat/login', method: 'POST', auth: false, data: {} });
  }
  return completeLogin(result, false);
}

async function ensureLogin(force) {
  const mode = normalizeDataMode(config.DATA_MODE);
  const cachedToken = wx.getStorageSync('mind_trace_token');
  const cachedUser = wx.getStorageSync('mind_trace_user');
  if (mode === 'http' && cachedToken && !force) return cachedUser || null;
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    if (mode === 'cloud') return cloudAuthenticate(force, cachedUser);
    const code = await wxLogin();
    const result = await request.raw({
      path: '/auth/wechat/login', method: 'POST', auth: false, data: { code }
    });
    return completeLogin(result, true);
  })();
  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

function clearSession() {
  wx.removeStorageSync('mind_trace_token');
  wx.removeStorageSync('mind_trace_user');
}

module.exports = { ensureLogin, clearSession };
