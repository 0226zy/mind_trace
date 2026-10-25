const { sameBackend } = require('./backend');

function getUserId(user) {
  if (!user) return '';
  const value = user.id !== undefined ? user.id : (user._id !== undefined ? user._id : user.userId);
  return value === undefined || value === null || value === '' ? '' : String(value);
}

function ownershipBlock(item, currentUserId, currentBackend) {
  const ownerUserId = item && item.ownerUserId ? String(item.ownerUserId) : '';
  const current = currentUserId ? String(currentUserId) : '';
  if (!ownerUserId) {
    return { reason: 'ownerMissing', message: '这条本地记录缺少原账号标识，已阻止同步并保留在本机。' };
  }
  if (!current) {
    return { reason: 'accountUnknown', message: '暂时无法确认当前账号，已阻止同步并保留在本机。' };
  }
  if (ownerUserId !== current) {
    return { reason: 'accountChanged', message: '检测到微信账号对应的用户已变化。为防止写入新账号，这条旧记录已阻止同步，数据仍保留在本机。' };
  }
  if (!item || !item.backendMode || !item.backendEnv) {
    return { reason: 'backendMissing', message: '这条旧记录缺少后端模式或环境标识，已阻止同步并保留在本机。' };
  }
  if (!currentBackend || !currentBackend.backendMode || !currentBackend.backendEnv) {
    return { reason: 'backendUnknown', message: '暂时无法确认当前后端环境，已阻止同步并保留在本机。' };
  }
  if (!sameBackend(item, currentBackend)) {
    return { reason: 'backendChanged', message: `记录属于 ${item.backendMode}/${item.backendEnv}，当前为 ${currentBackend.backendMode}/${currentBackend.backendEnv}。已阻止跨环境同步并保留本机数据。` };
  }
  return null;
}

function reconcileQueueOwnership(queue, currentUserId, currentBackend) {
  return (Array.isArray(queue) ? queue : []).map((item) => {
    const block = ownershipBlock(item, currentUserId, currentBackend);
    if (!block) return item;
    return Object.assign({}, item, {
      syncState: 'blocked',
      blockReason: block.reason,
      errorMessage: block.message
    });
  });
}

module.exports = { getUserId, ownershipBlock, reconcileQueueOwnership };
