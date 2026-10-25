const TIMER_KEY = 'mind_trace_emergency_timer_v1';

function clock(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

Page({
  data: {
    tool: 'senses', senseStep: 0, senseValues: [[], [], []], senseError: '', sensesDone: false,
    sensePrompts: [
      { title: '看见 5 样东西', hint: '慢慢说出它们的名字，不必评价。', count: 5, placeholders: ['例如：窗户', '例如：桌上的杯子', '例如：一本书', '例如：墙上的影子', '例如：自己的双手'] },
      { title: '听见 4 种声音', hint: '只辨认声音，让注意力停在当下。', count: 4, placeholders: ['例如：空调声', '例如：脚步声', '例如：车流声', '例如：自己的呼吸'] },
      { title: '触碰 3 个物体', hint: '感受它们的温度、材质和重量。', count: 3, placeholders: ['例如：衣料', '例如：桌面', '例如：水杯'] }
    ],
    phraseRepeated: false, remaining: 300, timeText: '05:00', timerRunning: false, timerDone: false
  },

  onLoad() {
    this.restoreTimer();
  },
  onShow() { if (this.data.timerRunning) this.startTicker(); },
  onHide() { this.clearTicker(); },
  onUnload() { this.clearTicker(); },

  switchTool(event) {
    this.setData({ tool: event.currentTarget.dataset.tool, senseError: '' });
  },

  onSenseInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const values = this.data.senseValues.slice();
    values[this.data.senseStep] = values[this.data.senseStep].slice();
    values[this.data.senseStep][index] = event.detail.value;
    this.setData({ senseValues: values, senseError: '' });
  },

  nextSense() {
    const values = this.data.senseValues[this.data.senseStep] || [];
    const expected = this.data.sensePrompts[this.data.senseStep].count;
    const complete = Array.from({ length: expected }, (_, index) => (values[index] || '').trim()).every(Boolean);
    if (!complete) { this.setData({ senseError: `请慢慢写完这 ${expected} 项，再继续` }); return; }
    if (this.data.senseStep === 2) this.setData({ sensesDone: true });
    else this.setData({ senseStep: this.data.senseStep + 1, senseError: '' });
  },

  previousSense() {
    if (this.data.senseStep > 0) this.setData({ senseStep: this.data.senseStep - 1, senseError: '' });
  },

  resetSenses() { this.setData({ senseStep: 0, senseValues: [[], [], []], sensesDone: false, senseError: '' }); },
  repeatPhrase() {
    this.setData({ phraseRepeated: true });
    wx.vibrateShort({ type: 'light', fail: () => {} });
  },

  restoreTimer() {
    const saved = wx.getStorageSync(TIMER_KEY);
    if (!saved) return;
    if (saved.running && saved.endsAt) {
      const remaining = Math.ceil((saved.endsAt - Date.now()) / 1000);
      if (remaining <= 0) { this.finishTimer(); return; }
      this.setData({ remaining, timeText: clock(remaining), timerRunning: true, timerDone: false });
      this.startTicker();
    } else if (saved.remaining > 0) {
      this.setData({ remaining: saved.remaining, timeText: clock(saved.remaining), timerRunning: false });
    }
  },

  startTimer() {
    const remaining = this.data.remaining > 0 ? this.data.remaining : 300;
    const endsAt = Date.now() + remaining * 1000;
    this.endsAt = endsAt;
    this.setData({ timerRunning: true, timerDone: false, remaining, timeText: clock(remaining) });
    wx.setStorageSync(TIMER_KEY, { running: true, endsAt });
    this.startTicker();
  },

  pauseTimer() {
    this.tick();
    this.clearTicker();
    this.setData({ timerRunning: false });
    wx.setStorageSync(TIMER_KEY, { running: false, remaining: this.data.remaining });
  },

  resetTimer() {
    this.clearTicker();
    wx.removeStorageSync(TIMER_KEY);
    this.setData({ remaining: 300, timeText: '05:00', timerRunning: false, timerDone: false });
  },

  startTicker() {
    this.clearTicker();
    const saved = wx.getStorageSync(TIMER_KEY);
    if (saved && saved.endsAt) this.endsAt = saved.endsAt;
    this.timer = setInterval(() => this.tick(), 500);
  },

  clearTicker() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  tick() {
    if (!this.data.timerRunning) return;
    const remaining = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
    this.setData({ remaining, timeText: clock(remaining) });
    if (remaining <= 0) this.finishTimer();
  },

  finishTimer() {
    this.clearTicker();
    wx.removeStorageSync(TIMER_KEY);
    this.setData({ remaining: 0, timeText: '00:00', timerRunning: false, timerDone: true });
    wx.vibrateLong({ fail: () => {} });
  },

  done() { wx.navigateBack(); }
});
