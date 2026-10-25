const EMOTIONS = ['焦虑', '紧张', '担忧', '自我怀疑', '愤怒', '其他'];
const STATUS = {
  registered: '待评估', evaluating: '评估中', paused: '已搁置', closed: '已收尾',
  active: '活跃', resolved: '已完结', recurring: '反复'
};

function pad(value) { return value < 10 ? `0${value}` : String(value); }

function formatTime(value, withTime) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const dateText = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  return withTime === false ? dateText : `${dateText} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusText(status) { return STATUS[status] || status || '未标记'; }

function normalizeRecord(record) {
  const item = record || {};
  return Object.assign({}, item, {
    id: item.id || item._id,
    triggerEvent: item.triggerEvent || item.trigger || '',
    emotions: item.emotions || (item.emotion ? [item.emotion] : []),
    statusText: statusText(item.status),
    step: Number(item.step || 0),
    createdAtText: formatTime(item.createdAt),
    updatedAtText: formatTime(item.updatedAt || item.createdAt)
  });
}

function normalizeThought(item) {
  const source = item || {};
  const thought = source.thought || source;
  const latest = source.latestRecord || source.record || thought.latestRecord || {};
  const emotions = source.emotions || latest.emotions || thought.emotions || [];
  const count = source.versionCount !== undefined ? source.versionCount
    : (thought.versionCount !== undefined ? thought.versionCount : (source.recordCount === undefined ? 1 : source.recordCount));
  return Object.assign({}, thought, {
    id: thought.id || thought._id,
    title: thought.title || latest.triggerEvent || latest.trigger || '未命名思虑',
    versionCount: Number(count),
    statusText: statusText(thought.status || latest.status),
    lastRecordAtText: formatTime(thought.lastRecordAt || latest.createdAt || thought.updatedAt),
    currentStep: Number(source.currentStep || latest.step || 0),
    currentStatus: latest.status || source.currentStatus || '',
    currentStatusText: statusText(latest.status || source.currentStatus),
    emotions,
    emotionsText: emotions.join(' · ')
  });
}

function normalizeThoughtDetail(result) {
  const source = result || {};
  const records = (source.records || []).map((record, index) => {
    const normalized = normalizeRecord(record);
    return Object.assign(normalized, {
      expanded: index === 0,
      actions: record.controllableActions || [],
      uncontrollables: record.uncontrollableItems || [],
      emotionsText: normalized.emotions.join('、')
    });
  });
  const latest = records[0] || {};
  const thought = normalizeThought(Object.assign({}, source.thought || {}, {
    versionCount: records.length,
    latestRecord: latest,
    lastRecordAt: latest.createdAt || (source.thought && source.thought.lastRecordAt)
  }));
  thought.versionCount = records.length;
  thought.lastRecordAt = latest.createdAt || thought.lastRecordAt;
  thought.lastRecordAtText = formatTime(thought.lastRecordAt);
  return { thought, records };
}

function normalizeIntensityTrend(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const rawValue = item.avgIntensity !== undefined ? item.avgIntensity
      : (item.averageIntensity !== undefined ? item.averageIntensity
        : (item.intensity !== undefined ? item.intensity : item.value));
    const value = Number(rawValue || 0);
    return {
      label: formatTime(item.date || item.day, false).slice(5),
      value: value.toFixed(1),
      height: Math.max(4, value / 10 * 100)
    };
  });
}

function percent(value) {
  const number = Number(value || 0);
  return `${Math.round(number <= 1 ? number * 100 : number)}%`;
}

module.exports = { EMOTIONS, STATUS, formatTime, statusText, normalizeRecord, normalizeThought, normalizeThoughtDetail, normalizeIntensityTrend, percent };
