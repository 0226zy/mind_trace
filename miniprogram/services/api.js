const request = require('./request');

function queryString(params) {
  return Object.keys(params || {}).filter((key) => params[key] !== '' && params[key] !== null && params[key] !== undefined)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join('&');
}

const api = {
  me: () => request({ path: '/me' }),
  deleteMe: () => request({ path: '/me', method: 'DELETE' }),
  dashboard: () => request({ path: '/dashboard' }),
  matchThoughts: (text) => request({ path: '/thoughts/match', method: 'POST', data: { text } }),
  createRecord: (payload, options) => request({ path: '/records', method: 'POST', data: payload, expectedOwnerUserId: options && options.expectedOwnerUserId }),
  records: (params) => request({ path: `/records?${queryString(params)}` }),
  record: (id) => request({ path: `/records/${encodeURIComponent(id)}` }),
  saveEvaluation: (id, payload) => request({ path: `/records/${encodeURIComponent(id)}`, method: 'PATCH', data: payload }),
  closeRecord: (id) => request({ path: `/records/${encodeURIComponent(id)}/close`, method: 'POST' }),
  pauseRecord: (id) => request({ path: `/records/${encodeURIComponent(id)}/pause`, method: 'POST' }),
  thoughts: (params) => request({ path: `/thoughts?${queryString(params)}` }),
  thought: (id) => request({ path: `/thoughts/${encodeURIComponent(id)}` }),
  stats: () => request({ path: '/stats/summary' })
};

module.exports = api;
