const request = require('./request');
const { getUserId } = require('../utils/ownership');

let loginPromise = null;

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => res.code ? resolve(res.code) : reject(new Error('未获得微信登录凭证')),
      fail: () => reject(new Error('微信登录暂时不可用'))
    });
  });
}

async function ensureLogin(force) {
  const cachedToken = wx.getStorageSync('mind_trace_token');
  const cachedUser = wx.getStorageSync('mind_trace_user');
  if (cachedToken && !force) return cachedUser || null;
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const code = await wxLogin();
    const result = await request.raw({
      path: '/auth/wechat/login', method: 'POST', auth: false, data: { code }
    });
    if (!result || !result.token) throw new Error('登录响应缺少 token');
    if (!getUserId(result.user)) throw new Error('登录响应缺少用户内部 ID');
    wx.setStorageSync('mind_trace_token', result.token);
    wx.setStorageSync('mind_trace_user', result.user);
    const app = getApp();
    if (app && app.globalData) app.globalData.user = result.user;
    // 任何 401 重登录或后台新登录都先冻结其他账号的离线记录。
    require('./sync').reconcileAccount(result.user);
    return result.user;
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
