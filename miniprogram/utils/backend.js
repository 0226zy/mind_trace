function getBackendContext(config) {
  const backendMode = config && config.DATA_MODE ? String(config.DATA_MODE) : '';
  const backendEnv = backendMode === 'cloud'
    ? String(config.CLOUD_ENV || 'default')
    : (backendMode === 'http' ? String(config.API_BASE || '') : '');
  return { backendMode, backendEnv };
}

function sameBackend(left, right) {
  return Boolean(left && right && left.backendMode && left.backendEnv && right.backendMode && right.backendEnv
    && String(left.backendMode) === String(right.backendMode)
    && String(left.backendEnv) === String(right.backendEnv));
}

module.exports = { getBackendContext, sameBackend };
