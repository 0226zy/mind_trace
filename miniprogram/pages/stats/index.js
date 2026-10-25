const api = require('../../services/api');
const auth = require('../../services/auth');
const { percent, normalizeIntensityTrend } = require('../../utils/format');

Page({
  data: { loading: true, error: '', stats: null, emotions: [], trend: [], completionRate: '0%', recurringCount: 0 },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await auth.ensureLogin();
      const stats = await api.stats();
      const counts = stats.emotionCounts || {};
      const emotions = Array.isArray(counts) ? counts.map((item) => ({ name: item.emotion || item.name, count: Number(item.count || 0) })) : Object.keys(counts).map((name) => ({ name, count: Number(counts[name] || 0) }));
      const maxEmotion = Math.max(1, ...emotions.map((item) => item.count));
      emotions.forEach((item) => { item.width = item.count / maxEmotion * 100; });
      emotions.sort((a, b) => b.count - a.count);
      const trend = normalizeIntensityTrend(stats.intensityTrend);
      const recurring = Array.isArray(stats.recurringThoughts) ? stats.recurringThoughts.length : Number(stats.recurringThoughts || 0);
      this.setData({ stats, emotions, trend, recurringCount: recurring, completionRate: percent(stats.completionRate), loading: false });
    } catch (error) { this.setData({ loading: false, error: error.message }); }
  }
});
