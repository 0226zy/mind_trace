const config = require('../../config');
const api = require('../../services/api');
const auth = require('../../services/auth');
const sync = require('../../services/sync');
const offline = require('../../utils/offline');
const { EMOTIONS } = require('../../utils/format');
const { validateQuick } = require('../../utils/validate');
const { emptyQuickForm, buildQuickPayload, deletionResetState } = require('../../utils/quick-state');

const emptyForm = emptyQuickForm;
const intensityOptions = [
  { label: '很轻', value: 2 },
  { label: '较轻', value: 4 },
  { label: '明显', value: 6 },
  { label: '较强', value: 8 },
  { label: '很强', value: 10 }
];

Component({
  options: { styleIsolation: 'shared' },
  properties: {
    visible: { type: Boolean, value: false }
  },
  data: {
    stage: 'edit', form: emptyForm(), canSubmit: false,
    emotionOptions: EMOTIONS.map((name) => ({ name, selected: false })), intensityOptions,
    error: '', matchError: '', submitting: false, similarItems: [], result: null,
    offlineSaved: false, restored: false, deletionEpoch: 0
  },
  lifetimes: {
    attached() {
      this.setData({ deletionEpoch: getApp().globalData.deletionEpoch });
      const draft = wx.getStorageSync(config.QUICK_DRAFT_KEY);
      if (draft && draft.form) {
        const form = Object.assign(emptyForm(), draft.form, { emotions: [], intensity: null });
        this.setData({ form, canSubmit: Boolean(form.loopThought.trim()), restored: true });
      }
    }
  },
  methods: {
    resetSensitiveData(deletionEpoch) {
      this.setData(Object.assign(deletionResetState(deletionEpoch), {
        emotionOptions: EMOTIONS.map((name) => ({ name, selected: false }))
      }));
      wx.removeStorageSync(config.QUICK_DRAFT_KEY);
    },
    ensureActiveEpoch() {
      const deletionEpoch = getApp().globalData.deletionEpoch;
      if (this.data.deletionEpoch === deletionEpoch) return true;
      this.resetSensitiveData(deletionEpoch);
      return false;
    },
    syncEmotionOptions() {
      const selected = this.data.form.emotions || [];
      this.setData({ emotionOptions: EMOTIONS.map((name) => ({ name, selected: selected.indexOf(name) >= 0 })) });
    },
    persistDraft() {
      if (!this.ensureActiveEpoch() || this.data.stage !== 'edit') return;
      wx.setStorageSync(config.QUICK_DRAFT_KEY, { form: this.data.form, updatedAt: new Date().toISOString() });
    },
    onInput(event) {
      const value = event.detail.value;
      this.setData({ 'form.loopThought': value, canSubmit: Boolean(value.trim()), error: '', restored: false });
      this.persistDraft();
    },
    onIntensity(event) {
      this.setData({ 'form.intensity': Number(event.currentTarget.dataset.value), error: '' });
    },
    toggleEmotion(event) {
      const emotion = event.currentTarget.dataset.emotion;
      const selected = this.data.form.emotions.slice();
      const index = selected.indexOf(emotion);
      if (index >= 0) selected.splice(index, 1);
      else selected.push(emotion);
      this.setData({ 'form.emotions': selected, error: '' });
      this.syncEmotionOptions();
    },
    resetAfterSaved() {
      this.setData({
        stage: 'edit', form: emptyForm(), canSubmit: false, result: null,
        offlineSaved: false, similarItems: [], error: '', matchError: '', restored: false
      });
      this.syncEmotionOptions();
    },
    close() {
      if (this.data.submitting) return;
      const savedStage = this.data.stage === 'details' || this.data.stage === 'complete';
      this.persistDraft();
      this.triggerEvent('close');
      if (savedStage) this.resetAfterSaved();
    },
    stopTouch() {},
    resetFeedback() {
      this.setData({ stage: 'edit', similarItems: [], matchError: '', error: '' });
    },
    async submit() {
      if (!this.ensureActiveEpoch() || this.data.submitting) return;
      const error = validateQuick(this.data.form);
      if (error) { this.setData({ error }); return; }
      this.setData({ submitting: true, error: '', matchError: '', stage: 'matching' });
      try {
        await auth.ensureLogin();
        if (!this.ensureActiveEpoch()) return;
        const result = await api.matchThoughts(this.data.form.loopThought.trim());
        if (!this.ensureActiveEpoch()) return;
        const items = (result && result.items) || [];
        if (items.length) this.setData({ stage: 'match', similarItems: items, submitting: false });
        else await this.createRecord();
      } catch (errorObject) {
        if (!this.ensureActiveEpoch()) return;
        if (errorObject.network) this.saveOffline();
        else this.setData({ stage: 'match', similarItems: [], matchError: '暂时无法检查相似思虑。你可以作为新思虑保存，或稍后再试。', submitting: false, error: errorObject.message });
      }
    },
    chooseSimilar(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.similarItems[index];
      if (!item) return;
      const thought = item.thought || item;
      const thoughtId = thought.id || thought._id;
      this.createRecord(thoughtId);
    },
    chooseNew() { this.createRecord(); },
    async createRecord(thoughtId) {
      if (!this.ensureActiveEpoch() || (this.data.submitting && this.data.stage === 'saving')) return;
      this.setData({ submitting: true, stage: 'saving', error: '' });
      const payload = buildQuickPayload(this.data.form, offline.createClientRequestId());
      if (thoughtId) payload.thoughtId = thoughtId;
      try {
        const result = await api.createRecord(payload);
        this.showSuccess(result, false);
      } catch (error) {
        if (!this.ensureActiveEpoch()) return;
        if (error.network) this.saveOffline(payload);
        else this.setData({ stage: 'match', error: error.message, submitting: false });
      }
    },
    saveOffline(existingPayload) {
      if (!this.ensureActiveEpoch()) return;
      const payload = existingPayload || buildQuickPayload(this.data.form, offline.createClientRequestId());
      const item = sync.enqueue(payload);
      this.showSuccess({ localRecord: item }, true);
    },
    showSuccess(result, offlineSaved) {
      if (!this.ensureActiveEpoch()) return;
      wx.removeStorageSync(config.QUICK_DRAFT_KEY);
      const form = Object.assign({}, this.data.form, { triggerEvent: '', emotions: [], intensity: null });
      this.setData({ stage: 'details', result, offlineSaved, submitting: false, form, similarItems: [], restored: false });
      this.syncEmotionOptions();
      this.triggerEvent('saved', { result, offlineSaved });
    },
    async saveDetails() {
      if (!this.ensureActiveEpoch() || this.data.submitting) return;
      const details = { emotions: this.data.form.emotions.slice(), intensity: this.data.form.intensity };
      if (!details.emotions.length && details.intensity === null) { this.close(); return; }
      this.setData({ submitting: true, error: '' });
      try {
        if (this.data.offlineSaved) {
          const localRecord = this.data.result && this.data.result.localRecord;
          if (!localRecord) throw new Error('这条本地记录已不存在');
          const updated = sync.updateQueuedDetails(localRecord.clientRequestId, details);
          this.setData({ stage: 'complete', result: { localRecord: updated }, submitting: false });
        } else {
          await auth.ensureLogin();
          if (!this.ensureActiveEpoch()) return;
          const current = this.data.result && this.data.result.record;
          const id = current && (current.id || current._id);
          if (!id) throw new Error('记录编号缺失，请稍后在处理页补充');
          const record = await api.saveRecordDetails(id, details);
          if (!this.ensureActiveEpoch()) return;
          this.setData({ stage: 'complete', result: Object.assign({}, this.data.result, { record }), submitting: false });
        }
      } catch (error) {
        if (!this.ensureActiveEpoch()) return;
        this.setData({ submitting: false, error: error.network ? '感受尚未保存，请检查网络后重试；正文已安全记录。' : error.message });
      }
    },
    later() { this.close(); },
    evaluateNow() {
      const record = this.data.result && this.data.result.record;
      if (record && (record.id || record._id)) {
        this.triggerEvent('evaluate', { id: record.id || record._id });
        this.close();
      }
    },
    emergency() {
      this.triggerEvent('emergency');
      this.close();
    }
  }
});
