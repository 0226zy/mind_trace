const config = require('../../config');
const api = require('../../services/api');
const auth = require('../../services/auth');
const { normalizeRecord } = require('../../utils/format');
const { cleanLines, evaluationStepError, buildEvaluationPayload } = require('../../utils/validate');

const initialForm = () => ({
  ruminationType: '', riskContent: '', probability: 50, actionsText: '', actionsDone: [],
  uncontrollableText: '', crossedOut: [], scenarioWorst: '', scenarioLikely: '', scenarioBest: '',
  closeConfirmations: [false, false, false]
});

function formFromRecord(record) {
  const form = initialForm();
  const actions = record.controllableActions || [];
  const items = record.uncontrollableItems || [];
  return Object.assign(form, {
    ruminationType: record.ruminationType || '',
    riskContent: record.riskContent || '',
    probability: record.probability === undefined ? 50 : Number(record.probability),
    actionsText: actions.map((item) => item.text || '').join('\n'),
    actionsDone: actions.map((item) => Boolean(item.done)),
    uncontrollableText: items.map((item) => item.text || '').join('\n'),
    crossedOut: items.map((item) => Boolean(item.crossedOut)),
    scenarioWorst: record.scenarioWorst || '', scenarioLikely: record.scenarioLikely || '',
    scenarioBest: record.scenarioBest || '',
    closeConfirmations: [0, 1, 2].map((index) => Boolean((record.closeConfirmations || [])[index]))
  });
}

Page({
  data: {
    recordId: '', record: null, form: initialForm(), step: 1, loading: true, error: '',
    stepError: '', saveState: '', readOnly: false, completed: false, breathing: false,
    actionItems: [], uncontrollableItems: [], closing: false, restored: false,
    stepTitles: ['判断', '风险', '概率', '可控行动', '不可控', '三种视角', '三项确认'],
    confirmations: ['我已对可控部分写出具体行动', '我已把不可控部分划掉', '我已确认：继续思考不再增加收益']
  },

  onLoad(options) {
    this.recordId = decodeURIComponent(options.id || '');
    this.draftKey = `${config.EVALUATION_DRAFT_PREFIX}${this.recordId}`;
    this.setData({ recordId: this.recordId });
    this.loadRecord();
  },

  onUnload() { this.cleanup(); },
  onHide() {
    if (!this.data.readOnly && !this.data.completed && !this.data.breathing && this.data.record) {
      this.saveLocal();
      this.saveRemote(this.data.step).catch(() => {});
    }
  },

  cleanup() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this.breathTimer) clearTimeout(this.breathTimer);
  },

  async loadRecord() {
    this.setData({ loading: true, error: '' });
    const draft = wx.getStorageSync(this.draftKey);
    try {
      await auth.ensureLogin();
      const result = await api.record(this.recordId);
      const record = normalizeRecord(result && result.record ? result.record : result);
      const useDraft = draft && draft.form && !record.closedAt && record.status !== 'closed';
      const form = useDraft ? Object.assign(initialForm(), draft.form) : formFromRecord(record);
      const step = useDraft ? Math.max(1, Math.min(7, Number(draft.step || record.step || 1))) : Math.max(1, Math.min(7, Number(record.step || 1)));
      this.setData({ record, form, step, readOnly: record.status === 'closed', loading: false, restored: Boolean(useDraft) });
      this.refreshLists();
    } catch (error) {
      if (draft && draft.form) {
        this.setData({ form: Object.assign(initialForm(), draft.form), step: Number(draft.step || 1), record: { id: this.recordId, status: 'evaluating' }, loading: false, restored: true, saveState: '当前离线，正在使用本机草稿' });
        this.refreshLists();
      } else this.setData({ loading: false, error: error.message });
    }
  },

  refreshLists() {
    const form = this.data.form;
    this.setData({
      actionItems: cleanLines(form.actionsText).map((text, index) => ({ text, done: Boolean(form.actionsDone[index]), index })),
      uncontrollableItems: cleanLines(form.uncontrollableText).map((text, index) => ({ text, crossedOut: Boolean(form.crossedOut[index]), index }))
    });
  },

  onInput(event) {
    if (this.data.readOnly) return;
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value, stepError: '', restored: false });
    if (field === 'actionsText' || field === 'uncontrollableText') this.refreshLists();
    this.scheduleSave();
  },

  chooseType(event) {
    this.setData({ 'form.ruminationType': event.currentTarget.dataset.value, stepError: '' });
    this.scheduleSave();
  },

  onProbability(event) {
    this.setData({ 'form.probability': Number(event.detail.value) });
    this.scheduleSave();
  },

  toggleAction(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`form.actionsDone[${index}]`]: !this.data.form.actionsDone[index] });
    this.refreshLists();
    this.scheduleSave();
  },

  toggleCrossed(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`form.crossedOut[${index}]`]: !this.data.form.crossedOut[index] });
    this.refreshLists();
    this.scheduleSave();
  },

  toggleConfirmation(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`form.closeConfirmations[${index}]`]: !this.data.form.closeConfirmations[index], stepError: '' });
    this.scheduleSave();
  },

  scheduleSave() {
    this.saveLocal();
    this.setData({ saveState: '已暂存本机' });
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => { this.saveRemote(this.data.step).catch(() => {}); }, 1400);
  },

  saveLocal() {
    if (!this.draftKey) return;
    wx.setStorageSync(this.draftKey, { form: this.data.form, step: this.data.step, savedAt: new Date().toISOString() });
  },

  async saveRemote(step) {
    if (this.remoteSaving) { this.remoteDirty = true; return; }
    this.remoteSaving = true;
    this.setData({ saveState: '正在同步草稿…' });
    try {
      await auth.ensureLogin();
      await api.saveEvaluation(this.recordId, buildEvaluationPayload(this.data.form, step));
      wx.removeStorageSync(this.draftKey);
      this.setData({ saveState: '草稿已同步' });
    } catch (error) {
      this.saveLocal();
      this.setData({ saveState: error.network ? '离线草稿已保存在本机' : `暂存本机：${error.message}` });
      throw error;
    } finally {
      this.remoteSaving = false;
      if (this.remoteDirty) {
        this.remoteDirty = false;
        this.saveRemote(this.data.step).catch(() => {});
      }
    }
  },

  async next() {
    const error = evaluationStepError(this.data.step, this.data.form);
    if (error) { this.setData({ stepError: error }); return; }
    if (this.data.step === 7) { this.closeRecord(); return; }
    const nextStep = this.data.step + 1;
    this.setData({ step: nextStep, stepError: '' });
    this.saveLocal();
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    try { await this.saveRemote(nextStep); } catch (errorObject) { /* 本机草稿已保留，可继续填写 */ }
  },

  previous() {
    if (this.data.step <= 1) { wx.navigateBack(); return; }
    this.setData({ step: this.data.step - 1, stepError: '' });
    this.saveLocal();
  },

  async saveAndExit() {
    this.saveLocal();
    try { await this.saveRemote(this.data.step); } catch (error) { wx.showToast({ title: '已保留本机草稿', icon: 'none' }); }
    wx.navigateBack();
  },

  async pauseRecord() {
    const confirmed = await new Promise((resolve) => wx.showModal({ title: '暂时搁置？', content: '草稿会保留，你可以随时从处理队列继续。', confirmText: '暂时搁置', success: (res) => resolve(res.confirm), fail: () => resolve(false) }));
    if (!confirmed) return;
    try {
      await this.saveRemote(this.data.step);
      await api.pauseRecord(this.recordId);
      wx.removeStorageSync(this.draftKey);
      wx.navigateBack();
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },

  async closeRecord() {
    if (this.data.closing) return;
    for (let step = 1; step <= 7; step += 1) {
      const error = evaluationStepError(step, this.data.form);
      if (error) { this.setData({ step, stepError: error }); return; }
    }
    this.setData({ closing: true, stepError: '' });
    try {
      let waited = 0;
      while (this.remoteSaving && waited < 40) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        waited += 1;
      }
      if (this.remoteSaving) throw new Error('草稿仍在同步，请稍后再收尾');
      await this.saveRemote(7);
      await api.closeRecord(this.recordId);
      wx.removeStorageSync(this.draftKey);
      this.setData({ breathing: true, closing: false });
      this.breathTimer = setTimeout(() => this.setData({ breathing: false, completed: true }), 3000);
    } catch (error) {
      this.setData({ closing: false, stepError: error.message });
    }
  },

  goLibrary() { wx.switchTab({ url: '/pages/library/index' }); },
  goProcess() { wx.switchTab({ url: '/pages/process/index' }); },
  back() { wx.navigateBack(); }
});
