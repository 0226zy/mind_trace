const api = require('../../services/api');
const auth = require('../../services/auth');
const { normalizeThoughtDetail } = require('../../utils/format');

Page({
  data: { thought: null, records: [], loading: true, error: '' },
  onLoad(options) { this.thoughtId = decodeURIComponent(options.id || ''); },
  onShow() { if (this.thoughtId) this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await auth.ensureLogin();
      const result = await api.thought(this.thoughtId);
      const { thought, records } = normalizeThoughtDetail(result);
      this.setData({ thought, records, loading: false });
    } catch (error) { this.setData({ loading: false, error: error.message }); }
  },
  toggleVersion(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`records[${index}].expanded`]: !this.data.records[index].expanded });
  },
  openEvaluation(event) {
    wx.navigateTo({ url: `/pages/evaluate/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  }
});
