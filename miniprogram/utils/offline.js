const { ownershipBlock } = require('./ownership');

function createClientRequestId() {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `mini_${time}_${random}`;
}

function nextQueue(queue, item) {
  const list = Array.isArray(queue) ? queue.slice() : [];
  const existing = list.findIndex((entry) => entry.clientRequestId === item.clientRequestId);
  if (existing >= 0) list[existing] = Object.assign({}, list[existing], item);
  else list.push(item);
  return list;
}

function markQueueItem(queue, clientRequestId, patch) {
  return (Array.isArray(queue) ? queue : []).map((item) => item.clientRequestId === clientRequestId
    ? Object.assign({}, item, patch) : item);
}

function removeQueueItem(queue, clientRequestId) {
  return (Array.isArray(queue) ? queue : []).filter((item) => item.clientRequestId !== clientRequestId);
}

function canAutoSync(item, currentUserId, currentBackend) {
  return Boolean(item && item.syncState === 'queued' && item.clientRequestId
    && !ownershipBlock(item, currentUserId, currentBackend));
}

function withQueuedDetails(queue, clientRequestId, details) {
  let found = false;
  const next = (Array.isArray(queue) ? queue : []).map((item) => {
    if (item.clientRequestId !== clientRequestId) return item;
    found = true;
    if (item.syncState !== 'queued') throw new Error('这条记录已开始同步，请稍后再补充感受');
    return Object.assign({}, item, {
      payload: Object.assign({}, item.payload, {
        emotions: details.emotions,
        intensity: details.intensity,
        clientRequestId: item.clientRequestId
      })
    });
  });
  if (!found) throw new Error('这条本地记录已不存在');
  return next;
}

module.exports = { createClientRequestId, nextQueue, markQueueItem, removeQueueItem, canAutoSync, withQueuedDetails };
