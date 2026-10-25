const sync = require('../../services/sync');
const auth = require('../../services/auth');
const { formatTime } = require('../../utils/format');
const { getUserId, ownershipBlock } = require('../../utils/ownership');
const { getBackendContext } = require('../../utils/backend');
const config = require('../../config');

Page({
  data: { item: null, syncing: false, syncedRecord: null, error: '' },
  onLoad(options) { this.clientRequestId = decodeURIComponent(options.clientRequestId || ''); },
  onShow() { this.loadItem(); },
  loadItem() {
    const item = sync.getQueue().find((entry) => entry.clientRequestId === this.clientRequestId);
    if (item) {
      const currentUserId = getUserId(wx.getStorageSync('mind_trace_user'));
      const block = ownershipBlock(item, currentUserId, getBackendContext(config));
      const reasons = { accountChanged: '账号已变化', backendChanged: '后端已变化', backendMissing: '缺少后端标识', backendUnknown: '后端待确认', ownerMissing: '缺少账号标识' };
      item.createdAtText = formatTime(item.createdAt);
      item.emotionsText = (item.payload.emotions || []).join('、');
      item.canRetry = !block;
      item.blockReason = block ? block.reason : (item.blockReason || '');
      item.errorMessage = block ? block.message : item.errorMessage;
      item.retryBlockedText = block && block.reason === 'accountChanged' ? '账号已变化，禁止同步'
        : (block && block.reason === 'backendChanged' ? '后端已变化，禁止同步' : '归属校验未通过，禁止同步');
      item.syncStateText = reasons[item.blockReason] || ({ queued: '待同步', sending: '同步中', uncertain: '结果待确认', failed: '同步失败', blocked: '同步已阻止' }[item.syncState] || '待同步');
    }
    this.setData({ item: item || null });
  },
  async retrySync() {
    if (!this.data.item || !this.data.item.canRetry || this.data.syncing) return;
    if (this.data.item.syncState === 'uncertain') {
      const confirmed = await new Promise((resolve) => wx.showModal({
        title: '确认重新发送？', content: '上次请求的结果不确定。请先在思虑库确认没有出现这条记录；重试会沿用同一 clientRequestId，便于服务端幂等去重。',
        confirmText: '确认重试', success: (res) => resolve(res.confirm), fail: () => resolve(false)
      }));
      if (!confirmed) return;
    }
    this.setData({ syncing: true, error: '' });
    try {
      const user = await auth.ensureLogin();
      const result = await sync.syncItem(this.clientRequestId, user);
      this.setData({ syncedRecord: result.record, item: null, syncing: false });
      wx.showToast({ title: '已同步', icon: 'success' });
    } catch (error) {
      this.setData({ syncing: false, error: error.message });
      this.loadItem();
    }
  },
  async removeLocal() {
    const confirmed = await new Promise((resolve) => wx.showModal({ title: '删除本机登记？', content: '这条记录尚未确认同步，删除后无法恢复。', confirmText: '删除', confirmColor: '#875F5A', success: (res) => resolve(res.confirm), fail: () => resolve(false) }));
    if (!confirmed) return;
    sync.saveQueue(sync.getQueue().filter((item) => item.clientRequestId !== this.clientRequestId));
    wx.navigateBack();
  },
  evaluate() {
    const record = this.data.syncedRecord;
    if (record) wx.redirectTo({ url: `/pages/evaluate/index?id=${encodeURIComponent(record.id || record._id)}` });
  }
});
