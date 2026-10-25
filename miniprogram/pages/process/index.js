const api = require('../../services/api');
const auth = require('../../services/auth');
const sync = require('../../services/sync');
const { normalizeRecord, formatTime } = require('../../utils/format');

Page({
  data: { tab: 'pending', loading: true, error: '', records: [], visibleRecords: [], offlineItems: [], syncing: false },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true, error: '' });
    this.refreshOffline();
    try {
      await auth.ensureLogin();
      const result = await api.records({ page: 1, pageSize: 100 });
      const records = ((result && result.items) || []).map(normalizeRecord);
      this.setData({ records, loading: false });
      this.filterRecords();
    } catch (error) {
      this.setData({ loading: false, error: error.message });
    }
  },
  refreshOffline() {
    const labels = { queued: '待同步', sending: '同步中', uncertain: '结果待确认', failed: '同步失败', blocked: '同步已阻止' };
    const queue = sync.getQueue();
    const offlineItems = queue.map((item) => ({
      clientRequestId: item.clientRequestId,
      ownerUserId: item.ownerUserId,
      triggerEvent: item.payload.triggerEvent,
      loopThought: item.payload.loopThought,
      emotionsText: (item.payload.emotions || []).join('、'),
      intensity: item.payload.intensity,
      syncState: item.syncState,
      blockReason: item.blockReason || '',
      syncStateText: item.blockReason === 'accountChanged' ? '账号已变化' : (labels[item.syncState] || '待同步'),
      errorMessage: item.errorMessage || '',
      createdAtText: formatTime(item.createdAt)
    }));
    this.setData({ offlineItems, hasBlockedAccountChange: queue.some((item) => item.blockReason === 'accountChanged') });
  },
  changeTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab });
    this.filterRecords();
  },
  filterRecords() {
    const pending = this.data.tab === 'pending';
    const visibleRecords = this.data.records.filter((item) => pending ? item.status !== 'closed' : item.status === 'closed')
      .sort((a, b) => pending ? Number(b.intensity || 0) - Number(a.intensity || 0) : new Date(b.closedAt || b.updatedAt) - new Date(a.closedAt || a.updatedAt));
    this.setData({ visibleRecords });
  },
  openRecord(event) {
    wx.navigateTo({ url: `/pages/evaluate/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  openLocal(event) {
    wx.navigateTo({ url: `/pages/local-record/index?clientRequestId=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  async syncNow() {
    if (this.data.syncing) return;
    this.setData({ syncing: true });
    try {
      const user = await auth.ensureLogin();
      await sync.flushQueue(user);
      wx.showToast({ title: '本地队列已检查', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ syncing: false });
      this.refreshOffline();
      this.load();
    }
  }
});
