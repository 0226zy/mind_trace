const api = require('../../services/api');
const auth = require('../../services/auth');
const sync = require('../../services/sync');
const config = require('../../config');

Page({
  data: { user: null, loading: true, error: '', pendingLocal: 0, backendMode: config.DATA_MODE, deleteVisible: false, confirmText: '', deleting: false, deleteError: '' },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: !this.data.user, error: '', pendingLocal: sync.getQueue().length });
    try {
      await auth.ensureLogin();
      const user = await api.me();
      user.displayInitial = (user.nickname || '止').slice(0, 1);
      this.setData({ user, loading: false });
    } catch (error) {
      const user = wx.getStorageSync('mind_trace_user') || null;
      if (user) user.displayInitial = (user.nickname || '止').slice(0, 1);
      this.setData({ loading: false, error: error.message, user });
    }
  },
  goStats() { wx.navigateTo({ url: '/pages/stats/index' }); },
  goProcess() { wx.switchTab({ url: '/pages/process/index' }); },
  checkLocalBeforeDelete() {
    this.setData({ deleteVisible: false, confirmText: '' });
    this.goProcess();
  },
  showDelete() { this.setData({ deleteVisible: true, confirmText: '', deleteError: '' }); },
  hideDelete() { if (!this.data.deleting) this.setData({ deleteVisible: false, confirmText: '', deleteError: '' }); },
  onConfirmInput(event) { this.setData({ confirmText: event.detail.value, deleteError: '' }); },
  stopTouch() {},
  async deleteAll() {
    if (this.data.confirmText !== '删除全部数据' || this.data.deleting) return;
    this.setData({ deleting: true, deleteError: '' });
    try {
      await auth.ensureLogin();
      await api.deleteMe();
      const app = getApp();
      app.globalData.deletionEpoch += 1;
      app.globalData.user = null;
      auth.clearSession();
      wx.clearStorageSync();
      this.setData({ deleting: false, deleteVisible: false });
      wx.showToast({ title: '全部数据已删除', icon: 'none' });
      setTimeout(() => wx.switchTab({ url: '/pages/now/index' }), 800);
    } catch (error) {
      this.setData({ deleting: false, deleteError: error.message });
    }
  }
});
