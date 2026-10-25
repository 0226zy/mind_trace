const config = require('../../config');
const api = require('../../services/api');
const auth = require('../../services/auth');
const sync = require('../../services/sync');
const offline = require('../../utils/offline');
const { EMOTIONS } = require('../../utils/format');
const { validateQuick } = require('../../utils/validate');
const { emptyQuickForm, deletionResetState } = require('../../utils/quick-state');

const emptyForm = emptyQuickForm;

Component({
  properties: {
    visible: { type: Boolean, value: false }
  },
  data: {
    stage: 'edit', form: emptyForm(), emotionOptions: EMOTIONS.map((name) => ({ name, selected: false })), error: '', matchError: '',
    submitting: false, similarItems: [], result: null, offlineSaved: false, restored: false, deletionEpoch: 0
  },
  lifetimes: {
    attached() {
      this.setData({ deletionEpoch: getApp().globalData.deletionEpoch });
      const draft = wx.getStorageSync(config.QUICK_DRAFT_KEY);
      if (draft && draft.form) {
        this.setData({ form: Object.assign(emptyForm(), draft.form), restored: true });
        this.syncEmotionOptions();
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
      const field = event.currentTarget.dataset.field;
      this.setData({ [`form.${field}`]: event.detail.value, error: '', restored: false });
      this.persistDraft();
    },
    onIntensity(event) {
      this.setData({ 'form.intensity': Number(event.detail.value), restored: false });
      this.persistDraft();
    },
    toggleEmotion(event) {
      const emotion = event.currentTarget.dataset.emotion;
      const selected = this.data.form.emotions.slice();
      const index = selected.indexOf(emotion);
      if (index >= 0) selected.splice(index, 1);
      else selected.push(emotion);
      this.setData({ 'form.emotions': selected, error: '', restored: false });
      this.syncEmotionOptions();
      this.persistDraft();
    },
    close() {
      if (this.data.submitting) return;
      this.persistDraft();
      this.triggerEvent('close');
      if (this.data.stage === 'success') {
        this.setData({ stage: 'edit', form: emptyForm(), result: null, offlineSaved: false, similarItems: [] });
      }
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
        const text = `${this.data.form.triggerEvent} ${this.data.form.loopThought}`;
        const result = await api.matchThoughts(text);
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
      const payload = Object.assign({}, this.data.form, {
        triggerEvent: this.data.form.triggerEvent.trim(),
        loopThought: this.data.form.loopThought.trim(),
        clientRequestId: offline.createClientRequestId()
      });
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
      const payload = existingPayload || Object.assign({}, this.data.form, { clientRequestId: offline.createClientRequestId() });
      const item = sync.enqueue(payload);
      this.showSuccess({ localRecord: item }, true);
    },
    showSuccess(result, offlineSaved) {
      if (!this.ensureActiveEpoch()) return;
      wx.removeStorageSync(config.QUICK_DRAFT_KEY);
      this.setData({ stage: 'success', result, offlineSaved, submitting: false, form: emptyForm(), similarItems: [], restored: false });
      this.syncEmotionOptions();
      this.triggerEvent('saved', { result, offlineSaved });
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
