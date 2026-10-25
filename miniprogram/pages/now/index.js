const api = require('../../services/api');
const auth = require('../../services/auth');

Page({
  data: {
    quickVisible: false, loading: true, error: '',
    dashboard: { todayCount: 0, pendingCount: 0, closedCount: 0, thoughtCount: 0 }, loaded: false
  },
  onShow() {
    const deletionEpoch = getApp().globalData.deletionEpoch;
    const quickNote = this.selectComponent('#quick-note');
    if (quickNote && quickNote.data.deletionEpoch !== deletionEpoch) {
      quickNote.resetSensitiveData(deletionEpoch);
      this.setData({ quickVisible: false });
    }
    this.loadDashboard();
  },
  async loadDashboard() {
    this.setData({ loading: !this.data.loaded, error: '' });
    try {
      await auth.ensureLogin();
      const dashboard = await api.dashboard();
      this.setData({ dashboard: Object.assign(this.data.dashboard, dashboard), loading: false, loaded: true });
    } catch (error) {
      this.setData({ loading: false, error: error.message });
    }
  },
  openQuick() { this.setData({ quickVisible: true }); },
  closeQuick() { this.setData({ quickVisible: false }); },
  onSaved() { this.loadDashboard(); },
  evaluateNow(event) {
    this.setData({ quickVisible: false });
    wx.navigateTo({ url: `/pages/evaluate/index?id=${encodeURIComponent(event.detail.id)}` });
  },
  goEmergency() {
    this.setData({ quickVisible: false });
    wx.navigateTo({ url: '/pages/emergency/index' });
  },
  goProfile() { wx.navigateTo({ url: '/pages/profile/index' }); },
  goProcess() { wx.switchTab({ url: '/pages/process/index' }); }
});
