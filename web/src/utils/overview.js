const first = (...values) => values.find((value) => value !== undefined && value !== null)

export function metric(data, name) {
  const aliases = {
    user: ['totalUsers'],
    thought: ['totalThoughts'],
    record: ['totalRecords'],
    closedRecord: ['totalClosedRecords', 'closedRecords', 'completionCount'],
  }
  const aliasValues = (aliases[name] || []).map((key) => data?.[key])
  return first(data?.[`${name}Count`], ...aliasValues, data?.[name]?.total, data?.[name]?.count, data?.[name], 0)
}

export function normalizeTrend(data) {
  const source = first(data?.recordTrend, data?.recordsTrend, data?.trend, data?.dailyRecords, [])
  if (!Array.isArray(source)) return []
  return source.map((item, index) => ({
    label: item?.date || item?.day || item?.label || `第 ${index + 1} 期`,
    value: Number(first(item?.count, item?.value, item?.records, typeof item === 'number' ? item : 0)) || 0,
  }))
}

export function recordShare(data) {
  const records = Number(metric(data, 'record')) || 0
  const closed = Number(first(data?.closedRecordCount, data?.closedRecords?.count, data?.closedRecords, 0)) || 0
  const pending = Math.max(records - closed, 0)
  return {
    records,
    closed,
    pending,
    closedRate: records ? Math.round((closed / records) * 100) : 0,
    openRate: records ? Math.round((pending / records) * 100) : 0,
  }
}
