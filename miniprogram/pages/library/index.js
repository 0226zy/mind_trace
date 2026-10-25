const api = require('../../services/api');
const auth = require('../../services/auth');
const { EMOTIONS, normalizeThought } = require('../../utils/format');

Page({
  data: {
    query: '', status: '', emotion: '', timeRange: '', frequentOnly: false,
    emotions: EMOTIONS, items: [], visibleItems: [], total: 0, page: 1, pageSize: 20,
    loading: true, loadingMore: false, error: '', filtersVisible: false,
    statuses: [{ label: '全部', value: '' }, { label: '活跃', value: 'active' }, { label: '已完结', value: 'resolved' }, { label: '反复', value: 'recurring' }],
    times: [{ label: '全部时间', value: '' }, { label: '近 7 天', value: '7' }, { label: '近 30 天', value: '30' }, { label: '近 90 天', value: '90' }]
  },
  onShow() { this.load(true); },
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (!this.data.loadingMore && this.data.items.length < this.data.total) this.load(false); },
  onQuery(event) { this.setData({ query: event.detail.value }); },
  search() { this.load(true); },
  clearSearch() { this.setData({ query: '' }); this.load(true); },
  toggleFilters() { this.setData({ filtersVisible: !this.data.filtersVisible }); },
  setStatus(event) { this.setData({ status: event.currentTarget.dataset.value }); this.load(true); },
  setEmotion(event) {
    const value = event.currentTarget.dataset.value;
    this.setData({ emotion: this.data.emotion === value ? '' : value });
    this.load(true);
  },
  setTime(event) { this.setData({ timeRange: event.currentTarget.dataset.value }); this.applyLocalFilters(); },
  toggleFrequent() { this.setData({ frequentOnly: !this.data.frequentOnly }); this.applyLocalFilters(); },
  resetFilters() {
    this.setData({ status: '', emotion: '', timeRange: '', frequentOnly: false, query: '' });
    this.load(true);
  },
  async load(reset) {
    if (reset) this.setData({ loading: true, error: '', page: 1, items: [] });
    else this.setData({ loadingMore: true });
    const page = reset ? 1 : this.data.page + 1;
    try {
      await auth.ensureLogin();
      const result = await api.thoughts({ query: this.data.query.trim(), status: this.data.status, emotion: this.data.emotion, page, pageSize: this.data.pageSize });
      const incoming = ((result && result.items) || []).map(normalizeThought);
      const items = reset ? incoming : this.data.items.concat(incoming);
      this.setData({ items, total: Number((result && result.total) || items.length), page, loading: false, loadingMore: false });
      this.applyLocalFilters();
    } catch (error) {
      this.setData({ loading: false, loadingMore: false, error: error.message });
    }
  },
  loadMore() {
    if (!this.data.loadingMore && this.data.items.length < this.data.total) this.load(false);
  },
  applyLocalFilters() {
    const days = Number(this.data.timeRange || 0);
    const cutoff = days ? Date.now() - days * 86400000 : 0;
    const visibleItems = this.data.items.filter((item) => {
      if (this.data.frequentOnly && item.versionCount < 3) return false;
      if (cutoff && new Date(item.lastRecordAt || item.updatedAt || 0).getTime() < cutoff) return false;
      return true;
    });
    this.setData({ visibleItems });
  },
  goStats() { wx.navigateTo({ url: '/pages/stats/index' }); },
  openThought(event) { wx.navigateTo({ url: `/pages/thought-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); }
});
