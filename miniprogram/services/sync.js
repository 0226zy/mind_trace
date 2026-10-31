const config = require('../config');
const api = require('./api');
const offline = require('../utils/offline');
const { getUserId, ownershipBlock, reconcileQueueOwnership } = require('../utils/ownership');
const { getBackendContext } = require('../utils/backend');

let flushing = null;

function getQueue() {
  return wx.getStorageSync(config.OFFLINE_QUEUE_KEY) || [];
}

function saveQueue(queue) {
  wx.setStorageSync(config.OFFLINE_QUEUE_KEY, queue);
  return queue;
}

function storedUserId() {
  return getUserId(wx.getStorageSync('mind_trace_user'));
}

function currentBackend() {
  return getBackendContext(config);
}

function blockError(block) {
  const error = new Error(block.message);
  error.accountChanged = block.reason === 'accountChanged';
  error.backendChanged = block.reason === 'backendChanged';
  error.blockReason = block.reason;
  return error;
}

function reconcileAccount(user) {
  const currentUserId = getUserId(user) || storedUserId();
  return saveQueue(reconcileQueueOwnership(getQueue(), currentUserId, currentBackend()));
}

function enqueue(payload) {
  const ownerUserId = storedUserId();
  const backend = currentBackend();
  const block = ownershipBlock(Object.assign({ ownerUserId }, backend), ownerUserId, backend);
  const item = Object.assign({
    clientRequestId: payload.clientRequestId || offline.createClientRequestId(),
    ownerUserId,
    payload: Object.assign({}, payload),
    syncState: block ? 'blocked' : 'queued',
    blockReason: block ? block.reason : '',
    createdAt: new Date().toISOString(),
    errorMessage: block ? block.message : ''
  }, backend);
  item.payload.clientRequestId = item.clientRequestId;
  saveQueue(offline.nextQueue(getQueue(), item));
  return item;
}

function patchItem(clientRequestId, patch) {
  saveQueue(offline.markQueueItem(getQueue(), clientRequestId, patch));
}

async function syncItem(clientRequestId, user) {
  const item = getQueue().find((entry) => entry.clientRequestId === clientRequestId);
  if (!item) throw new Error('这条本地记录已不存在');
  const currentUserId = getUserId(user) || storedUserId();
  const backend = currentBackend();
  const block = ownershipBlock(item, currentUserId, backend);
  if (block) {
    patchItem(clientRequestId, { syncState: 'blocked', blockReason: block.reason, errorMessage: block.message });
    throw blockError(block);
  }
  patchItem(clientRequestId, { syncState: 'sending', blockReason: '', errorMessage: '' });
  try {
    const result = await api.createRecord(item.payload, {
      expectedOwnerUserId: item.ownerUserId,
      expectedBackend: { backendMode: item.backendMode, backendEnv: item.backendEnv }
    });
    saveQueue(offline.removeQueueItem(getQueue(), clientRequestId));
    return result;
  } catch (error) {
    if (error.blockReason) {
      patchItem(clientRequestId, { syncState: 'blocked', blockReason: error.blockReason, errorMessage: error.message });
    } else {
      // 网络失败可能发生在服务端写入之后，标记待确认且绝不自动重发。
      patchItem(clientRequestId, {
        syncState: error.network ? 'uncertain' : 'failed',
        blockReason: '',
        errorMessage: error.message
      });
    }
    throw error;
  }
}

function flushQueue(user) {
  if (flushing) return flushing;
  const currentUserId = getUserId(user) || storedUserId();
  const backend = currentBackend();
  reconcileAccount(user);
  flushing = (async () => {
    const queue = getQueue();
    for (let index = 0; index < queue.length; index += 1) {
      const current = getQueue().find((entry) => entry.clientRequestId === queue[index].clientRequestId);
      if (!offline.canAutoSync(current, currentUserId, backend)) continue;
      try {
        await syncItem(current.clientRequestId, user);
      } catch (error) {
        break;
      }
    }
    return getQueue();
  })();
  return flushing.finally(() => { flushing = null; });
}

function updateQueuedDetails(clientRequestId, details) {
  const queue = offline.withQueuedDetails(getQueue(), clientRequestId, details);
  saveQueue(queue);
  return queue.find((item) => item.clientRequestId === clientRequestId);
}

function recoverInterruptedQueue() {
  const queue = getQueue();
  const recovered = queue.map((item) => item.syncState === 'sending' ? Object.assign({}, item, {
    syncState: 'uncertain',
    errorMessage: '上次同步被中断，结果待确认'
  }) : item);
  if (recovered.some((item, index) => item !== queue[index])) saveQueue(recovered);
}

module.exports = { getQueue, saveQueue, enqueue, patchItem, updateQueuedDetails, syncItem, flushQueue, recoverInterruptedQueue, reconcileAccount };
