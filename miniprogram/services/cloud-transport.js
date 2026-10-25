const config = require('../config');
const { getUserId } = require('../utils/ownership');

function attachActorUserId(event, storedUser) {
  const result = { action: event.action, payload: event.payload };
  if (event.action === 'login') return result;
  const actorUserId = getUserId(storedUser);
  if (actorUserId) result.actorUserId = actorUserId;
  return result;
}

function parseQuery(query) {
  if (!query) return {};
  return query.split('&').filter(Boolean).reduce((result, pair) => {
    const separator = pair.indexOf('=');
    const key = separator >= 0 ? pair.slice(0, separator) : pair;
    const value = separator >= 0 ? pair.slice(separator + 1) : '';
    result[decodeURIComponent(key)] = decodeURIComponent(value);
    return result;
  }, {});
}

function listPayload(query) {
  const payload = Object.assign({}, query);
  if (payload.page !== undefined) payload.page = Number(payload.page);
  if (payload.pageSize !== undefined) payload.pageSize = Number(payload.pageSize);
  return payload;
}

function mapCloudAction(path, method, data) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const parts = String(path || '').split('?');
  const pathname = parts[0];
  const query = listPayload(parseQuery(parts[1]));
  const body = data || {};
  let action = '';
  let payload = body;

  if (pathname === '/auth/wechat/login' && normalizedMethod === 'POST') {
    action = 'login';
    payload = Object.assign({}, body);
    delete payload.code;
  } else if (pathname === '/me' && normalizedMethod === 'GET') { action = 'me'; payload = {}; }
  else if (pathname === '/me' && normalizedMethod === 'DELETE') { action = 'deleteMe'; payload = {}; }
  else if (pathname === '/dashboard' && normalizedMethod === 'GET') { action = 'dashboard'; payload = {}; }
  else if (pathname === '/thoughts/match' && normalizedMethod === 'POST') { action = 'matchThoughts'; }
  else if (pathname === '/records' && normalizedMethod === 'POST') { action = 'createRecord'; }
  else if (pathname === '/records' && normalizedMethod === 'GET') { action = 'listRecords'; payload = query; }
  else if (pathname === '/thoughts' && normalizedMethod === 'GET') { action = 'listThoughts'; payload = query; }
  else if (pathname === '/stats/summary' && normalizedMethod === 'GET') { action = 'stats'; payload = {}; }
  else {
    let match = pathname.match(/^\/records\/([^/]+)\/(close|pause)$/);
    if (match && normalizedMethod === 'POST') {
      action = match[2] === 'close' ? 'closeRecord' : 'pauseRecord';
      payload = { id: decodeURIComponent(match[1]) };
    } else {
      match = pathname.match(/^\/records\/([^/]+)$/);
      if (match && (normalizedMethod === 'GET' || normalizedMethod === 'PATCH')) {
        action = normalizedMethod === 'GET' ? 'getRecord' : 'patchRecord';
        payload = Object.assign({ id: decodeURIComponent(match[1]) }, body);
      } else {
        match = pathname.match(/^\/thoughts\/([^/]+)$/);
        if (match && normalizedMethod === 'GET') {
          action = 'getThought';
          payload = { id: decodeURIComponent(match[1]) };
        }
      }
    }
  }
  if (!action) throw new Error(`未配置云 action：${normalizedMethod} ${pathname}`);
  return { action, payload };
}

function businessStatus(code, explicitStatus) {
  if (explicitStatus !== undefined && explicitStatus !== null) return Number(explicitStatus);
  return code === 'UNAUTHORIZED' || code === 'AUTH_REQUIRED' || code === 'USER_NOT_FOUND' ? 401 : 400;
}

function unwrapCloudResult(response) {
  const result = response && response.result !== undefined ? response.result : response;
  if (result && result.error) {
    const source = result.error;
    const error = new Error(source.message || '云服务未能完成请求');
    error.statusCode = businessStatus(source.code, source.statusCode === undefined ? result.statusCode : source.statusCode);
    error.code = source.code;
    throw error;
  }
  if (result && Object.prototype.hasOwnProperty.call(result, 'data')) return result.data;
  return result;
}

function cloudUnavailableError(message) {
  const error = new Error(message || '云服务连接失败，请稍后重试');
  error.network = true;
  return error;
}

function buildCloudInitOptions(env) {
  const options = { traceUser: true };
  if (env) options.env = env;
  return options;
}

function initializeCloud(wxApi, env) {
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.init !== 'function') {
    throw new Error('当前微信环境不支持云开发，请升级微信并开通云开发，或改用 HTTP 模式');
  }
  const options = buildCloudInitOptions(env);
  wxApi.cloud.init(options);
  return options;
}

async function cloudRequest(options, runtime) {
  const wxApi = runtime && runtime.wx ? runtime.wx : (typeof wx !== 'undefined' ? wx : null);
  const cloud = runtime && runtime.cloud ? runtime.cloud : (wxApi && wxApi.cloud);
  if (!cloud || typeof cloud.callFunction !== 'function') {
    throw cloudUnavailableError('云服务不可用，请检查微信云开发环境或改用 HTTP 模式');
  }
  const mapped = mapCloudAction(options.path, options.method, options.data);
  const storedUser = mapped.action !== 'login' && wxApi && typeof wxApi.getStorageSync === 'function'
    ? wxApi.getStorageSync('mind_trace_user') : null;
  const event = attachActorUserId(mapped, storedUser);
  let response;
  try {
    response = await cloud.callFunction({
      name: runtime && runtime.functionName ? runtime.functionName : config.CLOUD_FUNCTION_NAME,
      data: event
    });
  } catch (originalError) {
    const error = cloudUnavailableError();
    error.originalError = originalError;
    throw error;
  }
  return unwrapCloudResult(response);
}

module.exports = {
  parseQuery, mapCloudAction, attachActorUserId, unwrapCloudResult, buildCloudInitOptions,
  initializeCloud, cloudRequest, cloudUnavailableError
};
