const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateQuick, evaluationStepError, buildEvaluationPayload, cleanLines } = require('../utils/validate');
const offline = require('../utils/offline');
const { normalizeRecord, normalizeThought, normalizeThoughtDetail, normalizeIntensityTrend, percent } = require('../utils/format');
const { getUserId, ownershipBlock, reconcileQueueOwnership } = require('../utils/ownership');
const { getBackendContext } = require('../utils/backend');
const { deletionResetState, buildQuickPayload } = require('../utils/quick-state');
const { normalizeDataMode, selectTransport } = require('../utils/data-mode');
const {
  mapCloudAction, attachActorUserId, unwrapCloudResult, buildCloudInitOptions, initializeCloud, cloudRequest
} = require('../services/cloud-transport');

let count = 0;
let sequence = Promise.resolve();
function test(name, fn) {
  sequence = sequence.then(async () => {
    await fn();
    count += 1;
    console.log(`✓ ${name}`);
  });
}

const validQuick = { triggerEvent: '', emotions: [], intensity: null, loopThought: '如果数据被质疑怎么办' };
const cloudA = { backendMode: 'cloud', backendEnv: 'env-a' };
const cloudB = { backendMode: 'cloud', backendEnv: 'env-b' };
const httpA = { backendMode: 'http', backendEnv: 'https://api-a.example.com/api/v1' };
const httpB = { backendMode: 'http', backendEnv: 'https://api-b.example.com/api/v1' };

test('速记第一步只校验思虑正文', () => {
  assert.strictEqual(validateQuick(validQuick), '');
  assert.match(validateQuick(Object.assign({}, validQuick, { loopThought: '   ' })), /思虑/);
  assert.match(validateQuick(Object.assign({}, validQuick, { loopThought: '念'.repeat(1001) })), /1000/);
});

test('单正文创建载荷不伪造情绪强度并生成短标题', () => {
  const payload = buildQuickPayload({ loopThought: '  如果汇报被质疑怎么办\n先核对数据  ' }, 'mini_1');
  assert.deepStrictEqual(payload, {
    triggerEvent: '如果汇报被质疑怎么办', emotions: [], intensity: null,
    loopThought: '如果汇报被质疑怎么办\n先核对数据', clientRequestId: 'mini_1'
  });
  assert.strictEqual(Array.from(buildQuickPayload({ loopThought: `${'念'.repeat(120)}\n后续` }, 'mini_2').triggerEvent).length, 100);
});

test('仅 queued 离线记录可补充感受且保持幂等标识', () => {
  const item = { clientRequestId: 'mini_1', syncState: 'queued', payload: { loopThought: '正文', clientRequestId: 'mini_1' } };
  const queue = offline.withQueuedDetails([item], 'mini_1', { emotions: ['焦虑'], intensity: 6 });
  assert.deepStrictEqual(queue[0].payload, { loopThought: '正文', clientRequestId: 'mini_1', emotions: ['焦虑'], intensity: 6 });
  assert.strictEqual(item.payload.emotions, undefined);
  assert.throws(() => offline.withQueuedDetails([Object.assign({}, item, { syncState: 'uncertain' })], 'mini_1', { emotions: [], intensity: 4 }), /已开始同步/);
});

test('七步逐步校验与三项确认', () => {
  const form = { ruminationType: '有效推演', riskContent: '方案不通过', probability: 20, actionsText: '核对数据', uncontrollableText: '他人评价', scenarioWorst: '重做', scenarioLikely: '修改后通过', scenarioBest: '直接通过', closeConfirmations: [true, true, true] };
  for (let step = 1; step <= 7; step += 1) assert.strictEqual(evaluationStepError(step, form), '');
  assert.match(evaluationStepError(6, Object.assign({}, form, { scenarioBest: '' })), /三种视角/);
  assert.match(evaluationStepError(7, Object.assign({}, form, { closeConfirmations: [true, false, true] })), /三项/);
});

test('行动与不可控数组保留完成状态', () => {
  const payload = buildEvaluationPayload({ actionsText: '第一项\n\n第二项', actionsDone: [true, false], uncontrollableText: '天气\n评价', crossedOut: [true, false], closeConfirmations: [true, true, false], probability: 15 }, 5);
  assert.deepStrictEqual(payload.controllableActions, [{ text: '第一项', done: true }, { text: '第二项', done: false }]);
  assert.deepStrictEqual(payload.uncontrollableItems, [{ text: '天气', crossedOut: true }, { text: '评价', crossedOut: false }]);
  assert.deepStrictEqual(payload.closeConfirmations, [true, true, false]);
  assert.deepStrictEqual(cleanLines(' 一 \n\n 二 '), ['一', '二']);
});

test('离线队列按 clientRequestId 去重', () => {
  const item = { clientRequestId: 'mini_1', payload: {}, syncState: 'queued' };
  const queue = offline.nextQueue(offline.nextQueue([], item), Object.assign({}, item, { syncState: 'sending' }));
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].syncState, 'sending');
  assert.strictEqual(offline.removeQueueItem(queue, 'mini_1').length, 0);
});

test('自动同步要求 queued、幂等 ID 与相同账号', () => {
  const item = Object.assign({ clientRequestId: 'a', ownerUserId: 'user-a', syncState: 'queued' }, cloudA);
  assert.strictEqual(offline.canAutoSync(item, 'user-a', cloudA), true);
  assert.strictEqual(offline.canAutoSync(item, 'user-b', cloudA), false);
  assert.strictEqual(offline.canAutoSync(item, '', cloudA), false);
  assert.strictEqual(offline.canAutoSync(Object.assign({}, item, { syncState: 'uncertain' }), 'user-a', cloudA), false);
  assert.strictEqual(offline.canAutoSync(Object.assign({}, item, { syncState: 'sending' }), 'user-a', cloudA), false);
  assert.strictEqual(offline.canAutoSync({ clientRequestId: 'a', syncState: 'queued' }, 'user-a', cloudA), false);
});

test('设备 A 离线记录在设备 B 注销后禁止写入新账号且不被删除', () => {
  const deviceAQueue = [Object.assign({ clientRequestId: 'offline-a', ownerUserId: 'internal-user-a', syncState: 'queued', payload: { loopThought: '旧账号敏感内容' } }, cloudA)];
  assert.strictEqual(getUserId({ _id: 'internal-user-a' }), 'internal-user-a');
  const afterNewLogin = reconcileQueueOwnership(deviceAQueue, 'internal-user-b', cloudA);
  assert.strictEqual(afterNewLogin.length, 1);
  assert.strictEqual(afterNewLogin[0].syncState, 'blocked');
  assert.strictEqual(afterNewLogin[0].blockReason, 'accountChanged');
  assert.strictEqual(afterNewLogin[0].ownerUserId, 'internal-user-a');
  assert.strictEqual(afterNewLogin[0].payload.loopThought, '旧账号敏感内容');
  assert.strictEqual(offline.canAutoSync(afterNewLogin[0], 'internal-user-b', cloudA), false);
  assert.strictEqual(ownershipBlock(afterNewLogin[0], 'internal-user-b', cloudA).reason, 'accountChanged');
});

test('正常 token 过期后同一内部用户仍可重试', () => {
  const item = Object.assign({ clientRequestId: 'offline-a', ownerUserId: 'internal-user-a', syncState: 'queued' }, cloudA);
  assert.strictEqual(ownershipBlock(item, 'internal-user-a', cloudA), null);
  const reconciled = reconcileQueueOwnership([item], 'internal-user-a', cloudA);
  assert.strictEqual(reconciled[0].syncState, 'queued');
  assert.strictEqual(offline.canAutoSync(reconciled[0], 'internal-user-a', cloudA), true);
  assert.strictEqual(ownershipBlock({ clientRequestId: 'legacy' }, 'internal-user-a', cloudA).reason, 'ownerMissing');
});

test('cloud 与 HTTP 互切时阻断同步并保留原记录', () => {
  const item = Object.assign({ clientRequestId: 'mode-switch', ownerUserId: 'user-a', syncState: 'queued', payload: { loopThought: '保留内容' } }, cloudA);
  assert.strictEqual(ownershipBlock(item, 'user-a', httpA).reason, 'backendChanged');
  assert.strictEqual(offline.canAutoSync(item, 'user-a', httpA), false);
  const reconciled = reconcileQueueOwnership([item], 'user-a', httpA);
  assert.strictEqual(reconciled[0].syncState, 'blocked');
  assert.strictEqual(reconciled[0].blockReason, 'backendChanged');
  assert.deepStrictEqual(reconciled[0].payload, item.payload);
});

test('cloud 环境 env-a 切换到 env-b 时阻断同步', () => {
  const item = Object.assign({ clientRequestId: 'cloud-env-switch', ownerUserId: 'user-a', syncState: 'queued' }, cloudA);
  assert.strictEqual(ownershipBlock(item, 'user-a', cloudB).reason, 'backendChanged');
  assert.strictEqual(offline.canAutoSync(item, 'user-a', cloudB), false);
});

test('HTTP API A 切换到 API B 时阻断同步', () => {
  const item = Object.assign({ clientRequestId: 'http-env-switch', ownerUserId: 'user-a', syncState: 'queued' }, httpA);
  assert.strictEqual(ownershipBlock(item, 'user-a', httpB).reason, 'backendChanged');
  assert.strictEqual(offline.canAutoSync(item, 'user-a', httpB), false);
});

test('同用户同后端保持可同步状态', () => {
  const item = Object.assign({ clientRequestId: 'same-backend', ownerUserId: 'user-a', syncState: 'queued' }, cloudA);
  assert.strictEqual(ownershipBlock(item, 'user-a', cloudA), null);
  assert.strictEqual(offline.canAutoSync(item, 'user-a', cloudA), true);
  const reconciled = reconcileQueueOwnership([item], 'user-a', cloudA);
  assert.strictEqual(reconciled[0].syncState, 'queued');
});

test('旧队列缺少后端标识时阻断同步并保留数据', () => {
  const item = { clientRequestId: 'legacy-backend', ownerUserId: 'user-a', syncState: 'queued', payload: { loopThought: '旧记录' } };
  assert.strictEqual(ownershipBlock(item, 'user-a', cloudA).reason, 'backendMissing');
  assert.strictEqual(offline.canAutoSync(item, 'user-a', cloudA), false);
  const reconciled = reconcileQueueOwnership([item], 'user-a', cloudA);
  assert.strictEqual(reconciled[0].syncState, 'blocked');
  assert.strictEqual(reconciled[0].blockReason, 'backendMissing');
  assert.deepStrictEqual(reconciled[0].payload, item.payload);
});

test('后端上下文区分 cloud 默认环境、指定环境与 HTTP API', () => {
  assert.deepStrictEqual(getBackendContext({ DATA_MODE: 'cloud', CLOUD_ENV: '' }), { backendMode: 'cloud', backendEnv: 'default' });
  assert.deepStrictEqual(getBackendContext({ DATA_MODE: 'cloud', CLOUD_ENV: 'env-a' }), cloudA);
  assert.deepStrictEqual(getBackendContext({ DATA_MODE: 'http', API_BASE: httpA.backendEnv }), httpA);
});

test('注销代次重置清除速记表单、结果与草稿状态', () => {
  const state = deletionResetState(2);
  assert.strictEqual(state.deletionEpoch, 2);
  assert.deepStrictEqual(state.form, { triggerEvent: '', emotions: [], intensity: null, loopThought: '' });
  assert.strictEqual(state.canSubmit, false);
  assert.strictEqual(state.result, null);
  assert.deepStrictEqual(state.similarItems, []);
  assert.strictEqual(state.stage, 'edit');
  assert.strictEqual(state.offlineSaved, false);
  assert.strictEqual(state.restored, false);
  assert.strictEqual(state.submitting, false);
  assert.strictEqual(state.error, '');
});

test('服务端字段兼容与展示归一化', () => {
  const record = normalizeRecord({ _id: 'r1', trigger: '场景', emotion: '焦虑', status: 'registered', step: 2 });
  assert.strictEqual(record.id, 'r1');
  assert.strictEqual(record.triggerEvent, '场景');
  assert.deepStrictEqual(record.emotions, ['焦虑']);
  assert.strictEqual(record.statusText, '待评估');
  const thought = normalizeThought({ _id: 't1', latestRecord: { triggerEvent: '最近场景', emotions: ['焦虑', '担忧'], status: 'evaluating', step: 3 }, versionCount: 3 });
  assert.strictEqual(thought.title, '最近场景');
  assert.strictEqual(thought.emotionsText, '焦虑 · 担忧');
  assert.strictEqual(thought.currentStep, 3);
  assert.strictEqual(percent(0.5), '50%');
  assert.strictEqual(percent(50), '50%');
});

test('统计 avgIntensity 与裸 thought 详情正确归一化', () => {
  const trend = normalizeIntensityTrend([{ date: '2026-10-25T00:00:00.000Z', avgIntensity: 6.4 }, { date: '2026-10-24T00:00:00.000Z', averageIntensity: 3 }]);
  assert.strictEqual(trend[0].value, '6.4');
  assert.strictEqual(trend[0].height, 64);
  assert.strictEqual(trend[1].value, '3.0');
  const latestAt = '2026-10-25T08:00:00.000Z';
  const detail = normalizeThoughtDetail({
    thought: { _id: 'thought-1', title: '季度方案数据', status: 'recurring' },
    records: [
      { _id: 'r2', createdAt: latestAt, triggerEvent: '第二次汇报', status: 'registered' },
      { _id: 'r1', createdAt: '2026-09-02T08:00:00.000Z', triggerEvent: '第一次汇报', status: 'closed' }
    ]
  });
  assert.strictEqual(detail.thought.title, '季度方案数据');
  assert.strictEqual(detail.thought.versionCount, 2);
  assert.strictEqual(detail.thought.lastRecordAt, latestAt);
  assert.strictEqual(detail.records.length, 2);
  assert.strictEqual(detail.records[0].expanded, true);
});

test('原生项目结构、真实 AppID 与页面文件完整', () => {
  const root = path.resolve(__dirname, '..');
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.match(project.appid, /^wx[0-9a-f]{16}$/);
  assert.notStrictEqual(project.appid, 'touristappid');
  assert.strictEqual(project.compileType, 'miniprogram');
  assert.strictEqual(app.tabBar.list.length, 3);
  assert.ok(project.packOptions.ignore.some((item) => item.type === 'folder' && item.value === 'scripts'), 'scripts 目录必须忽略上传');
  app.pages.forEach((page) => ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    assert.ok(fs.existsSync(path.join(root, `${page}.${ext}`)), `${page}.${ext} 缺失`);
  }));
  ['app.js', 'app.json', 'app.wxss', 'sitemap.json'].forEach((file) => assert.ok(fs.existsSync(path.join(root, file))));
  const source = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.ok(!/AppSecret\s*[:=]\s*['"][^'"]+/.test(source));
});

test('WXML 不使用方法调用且事件有对应实现', () => {
  const root = path.resolve(__dirname, '..');
  const files = [];
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.name === 'tests' || entry.name === '.artifacts') return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.wxml')) files.push(full);
    });
  }
  walk(root);
  files.forEach((file) => {
    const xml = fs.readFileSync(file, 'utf8');
    assert.ok(!/\{\{[^\n}]*\.[A-Za-z_$][\w$]*\(/.test(xml), `${file} 含 WXML 方法调用`);
    const js = fs.readFileSync(file.replace(/\.wxml$/, '.js'), 'utf8');
    const handlers = [...xml.matchAll(/(?:bind|catch)(?:tap|input|change|confirm):?="([A-Za-z_$][\w$]*)"/g)].map((match) => match[1]);
    handlers.forEach((handler) => assert.ok(new RegExp(`${handler}\\s*\\(`).test(js), `${file} 缺少 ${handler}`));
  });
});

test('数据模式解析与传输选择保留 cloud/http 双模式', () => {
  assert.strictEqual(normalizeDataMode('cloud'), 'cloud');
  assert.strictEqual(normalizeDataMode('http'), 'http');
  assert.throws(() => normalizeDataMode('database'), /仅支持/);
  const cloud = () => 'cloud-result';
  const http = () => 'http-result';
  assert.strictEqual(selectTransport('cloud', { cloud, http })(), 'cloud-result');
  assert.strictEqual(selectTransport('http', { cloud, http })(), 'http-result');
  assert.throws(() => selectTransport('cloud', { http }), /传输层不可用/);
});

test('HTTP path、method、query、data 完整映射云 action', () => {
  const cases = [
    ['/auth/wechat/login', 'POST', { code: 'secret-code', nickname: '止念' }, 'login', { nickname: '止念' }],
    ['/me', 'GET', undefined, 'me', {}],
    ['/me', 'DELETE', undefined, 'deleteMe', {}],
    ['/dashboard', 'GET', undefined, 'dashboard', {}],
    ['/thoughts/match', 'POST', { text: '方案' }, 'matchThoughts', { text: '方案' }],
    ['/records', 'POST', { triggerEvent: '汇报' }, 'createRecord', { triggerEvent: '汇报' }],
    ['/records?status=registered&page=2&pageSize=20', 'GET', undefined, 'listRecords', { status: 'registered', page: 2, pageSize: 20 }],
    ['/records/r%201', 'GET', undefined, 'getRecord', { id: 'r 1' }],
    ['/records/r1', 'PATCH', { step: 3 }, 'patchRecord', { id: 'r1', step: 3 }],
    ['/records/r1/close', 'POST', undefined, 'closeRecord', { id: 'r1' }],
    ['/records/r1/pause', 'POST', undefined, 'pauseRecord', { id: 'r1' }],
    ['/thoughts?query=%E6%96%B9%E6%A1%88&page=1&pageSize=20', 'GET', undefined, 'listThoughts', { query: '方案', page: 1, pageSize: 20 }],
    ['/thoughts/t1', 'GET', undefined, 'getThought', { id: 't1' }],
    ['/stats/summary', 'GET', undefined, 'stats', {}]
  ];
  cases.forEach(([requestPath, method, data, action, payload]) => {
    assert.deepStrictEqual(mapCloudAction(requestPath, method, data), { action, payload });
  });
  assert.throws(() => mapCloudAction('/unknown', 'GET'), /未配置云 action/);
});

test('云事件仅为非 login 请求附加缓存用户 actorUserId', () => {
  const login = { action: 'login', payload: { nickname: '止念' }, actorUserId: 'forged-user' };
  assert.deepStrictEqual(attachActorUserId(login, { _id: 'user-a' }), { action: 'login', payload: { nickname: '止念' } });
  assert.deepStrictEqual(attachActorUserId({ action: 'me', payload: {} }, { _id: 'user-a' }), { action: 'me', payload: {}, actorUserId: 'user-a' });
  assert.deepStrictEqual(attachActorUserId({ action: 'createRecord', payload: { actorUserId: 'forged-user' } }, { id: 'user-a' }), {
    action: 'createRecord', payload: { actorUserId: 'forged-user' }, actorUserId: 'user-a'
  });
  assert.deepStrictEqual(attachActorUserId({ action: 'me', payload: {}, actorUserId: 'forged-user' }, null), { action: 'me', payload: {} });
});

test('云响应成功解包 data，业务错误保留 statusCode 与 code', () => {
  assert.deepStrictEqual(unwrapCloudResult({ result: { data: { user: { _id: 'u1' } } } }), { user: { _id: 'u1' } });
  assert.throws(() => unwrapCloudResult({ result: { error: { code: 'VALIDATION_ERROR', message: '字段不完整', statusCode: 422 } } }), (error) => {
    return error.statusCode === 422 && error.code === 'VALIDATION_ERROR' && error.message === '字段不完整' && !error.network;
  });
  assert.throws(() => unwrapCloudResult({ result: { error: { code: 'UNAUTHORIZED', message: '用户不存在' } } }), (error) => error.statusCode === 401);
});

test('云 transport 调用 mindTrace，连接失败标记 network', async () => {
  let invocation;
  let storageKey = '';
  const cloud = {
    callFunction: async (options) => {
      invocation = options;
      return { result: { data: { record: { _id: 'r1' } } } };
    }
  };
  const wxApi = { getStorageSync: (key) => { storageKey = key; return { _id: 'user-a' }; } };
  const result = await cloudRequest({ path: '/records', method: 'POST', data: { triggerEvent: '场景' } }, { cloud, wx: wxApi, functionName: 'mindTrace' });
  assert.strictEqual(result.record._id, 'r1');
  assert.strictEqual(invocation.name, 'mindTrace');
  assert.strictEqual(storageKey, 'mind_trace_user');
  assert.deepStrictEqual(invocation.data, { action: 'createRecord', payload: { triggerEvent: '场景' }, actorUserId: 'user-a' });
  await assert.rejects(cloudRequest({ path: '/me' }, {
    functionName: 'mindTrace', cloud: { callFunction: async () => { throw new Error('SDK failure'); } }
  }), (error) => error.network === true && error.message === '云服务连接失败，请稍后重试' && error.originalError.message === 'SDK failure');
});

test('云初始化包含 traceUser，按配置省略或传递 env', () => {
  assert.deepStrictEqual(buildCloudInitOptions(''), { traceUser: true });
  assert.deepStrictEqual(buildCloudInitOptions('cloud-prod'), { traceUser: true, env: 'cloud-prod' });
  let options;
  assert.deepStrictEqual(initializeCloud({ cloud: { init: (value) => { options = value; } } }, 'cloud-prod'), { traceUser: true, env: 'cloud-prod' });
  assert.deepStrictEqual(options, { traceUser: true, env: 'cloud-prod' });
  assert.throws(() => initializeCloud({}, ''), /不支持云开发/);
});

test('云项目配置、默认模式与页面数据库隔离', () => {
  const root = path.resolve(__dirname, '..');
  const config = require('../config');
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert.strictEqual(config.DATA_MODE, 'cloud');
  assert.strictEqual(typeof config.CLOUD_ENV, 'string');
  assert.ok(config.CLOUD_ENV.trim(), '必须显式配置云环境 ID');
  assert.strictEqual(config.CLOUD_FUNCTION_NAME, 'mindTrace');
  assert.ok(config.API_BASE);
  assert.strictEqual(project.cloudfunctionRoot, 'cloudfunctions/');
  ['tests', 'scripts', '.artifacts'].forEach((folder) => {
    assert.ok(project.packOptions.ignore.some((item) => item.type === 'folder' && item.value === folder));
  });
  assert.ok(!project.packOptions.ignore.some((item) => String(item.value).includes('cloudfunctions')));
  const pagesDir = path.join(root, 'pages');
  fs.readdirSync(pagesDir).forEach((page) => {
    const file = path.join(pagesDir, page, 'index.js');
    if (fs.existsSync(file)) assert.ok(!fs.readFileSync(file, 'utf8').includes('wx.cloud.database'));
  });
});

test('安静视觉系统使用语义令牌并保持内容优先', () => {
  const root = path.resolve(__dirname, '..');
  const style = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
  ['--color-bg', '--color-text', '--color-muted', '--color-line', '--color-accent', '--space-4', '--radius-m', '--font-title', '--font-body', '--font-meta', '--motion-fast'].forEach((token) => assert.ok(style.includes(token), `缺少设计令牌 ${token}`));
  const now = fs.readFileSync(path.join(root, 'pages/now/index.wxml'), 'utf8');
  assert.strictEqual((now.match(/class="primary-btn/g) || []).length, 1, '首页只能有一个主按钮');
  assert.ok(now.includes('把念头先放在这里。') && now.includes('capture-btn'), '首页聚焦记录入口');
  const quick = fs.readFileSync(path.join(root, 'components/quick-note/index.wxml'), 'utf8');
  assert.ok(!quick.includes('相似度'), '相似候选不显示相似度百分比');
  assert.ok(quick.indexOf('bindtap="saveDetails">回到此刻') < quick.indexOf('bindtap="evaluateWithDetails"'), '回到此刻应先于现在评估');
  const library = fs.readFileSync(path.join(root, 'pages/library/index.wxml'), 'utf8');
  assert.ok(library.indexOf('thought-title') < library.indexOf('thought-meta'), '思虑库标题应先于状态元信息');
  assert.ok(library.includes('已加载内容中显示 '), '本地筛选必须说明结果范围');
  const evaluate = fs.readFileSync(path.join(root, 'pages/evaluate/index.wxml'), 'utf8');
  assert.ok(!evaluate.includes('class="card readonly-card"'), '只读结果不使用连续卡片堆叠');
  assert.ok(!evaluate.includes('bindtap="{{'), '事件处理函数必须静态绑定');
  const local = fs.readFileSync(path.join(root, 'pages/local-record/index.wxml'), 'utf8');
  assert.ok(!local.includes('{{item.clientRequestId}}'), '普通界面不展示完整技术幂等标识');
});

test('刷新保留旧内容且错误与选中态不造成布局跳动', () => {
  const root = path.resolve(__dirname, '..');
  const expectations = [
    ['pages/process/index.js', 'loading: !this.data.records.length'],
    ['pages/library/index.js', 'loading: !this.data.items.length'],
    ['pages/thought-detail/index.js', 'loading: !this.data.thought'],
    ['pages/stats/index.js', 'loading: !this.data.stats'],
    ['pages/profile/index.js', 'loading: !this.data.user']
  ];
  expectations.forEach(([file, source]) => assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes(source), `${file} 返回刷新不应清空旧内容`));
  ['pages/process/index.wxml', 'pages/library/index.wxml', 'pages/thought-detail/index.wxml', 'pages/stats/index.wxml'].forEach((file) => assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes('inline-error'), `${file} 缺少保留内容时的就地错误`));
  const quick = fs.readFileSync(path.join(root, 'components/quick-note/index.wxml'), 'utf8');
  assert.ok(quick.includes('form-error') && quick.includes('aria-hidden="{{!error}}"'));
  const evaluate = fs.readFileSync(path.join(root, 'pages/evaluate/index.wxml'), 'utf8');
  assert.ok(!evaluate.includes('wx:if="{{stepError}}"'));
  const state = fs.readFileSync(path.join(root, 'components/state-view/index.wxml'), 'utf8');
  assert.ok(state.includes('role="alert"') && state.includes('role="status"') && state.includes('aria-hidden="true"'));
});

test('保存感受后可直接回到此刻或进入评估', async () => {
  const api = require('../services/api');
  const auth = require('../services/auth');
  const original = { api: api.saveRecordDetails, login: auth.ensureLogin, wx: global.wx, app: global.getApp, component: global.Component };
  let definition;
  const events = [];
  global.wx = { removeStorageSync() {}, setStorageSync() {} };
  global.getApp = () => ({ globalData: { deletionEpoch: 0 } });
  global.Component = (value) => { definition = value; };
  try {
    require('../components/quick-note/index');
    function instance() {
      const target = Object.assign({}, definition.methods, {
        data: Object.assign(JSON.parse(JSON.stringify(definition.data)), {
          stage: 'details', deletionEpoch: 0, offlineSaved: false,
          form: { triggerEvent: '', loopThought: '正文', emotions: ['焦虑'], intensity: 6 },
          result: { record: { _id: 'record-1' } }
        }),
        setData(update) { Object.assign(this.data, update); },
        triggerEvent(name, detail) { events.push({ name, detail }); }
      });
      return target;
    }
    api.saveRecordDetails = async (id, details) => ({ _id: id, emotions: details.emotions, intensity: details.intensity });
    auth.ensureLogin = async () => ({ _id: 'user-1' });

    const returning = instance();
    await returning.saveDetails();
    assert.strictEqual(returning.data.stage, 'edit', '保存感受后应直接关闭并重置');
    assert.strictEqual(returning.data.submitting, false);
    assert.strictEqual(events[0].name, 'close');

    const evaluating = instance();
    await evaluating.evaluateWithDetails();
    const evaluation = events.find((event) => event.name === 'evaluate');
    assert.strictEqual(evaluation.detail.id, 'record-1');
    assert.strictEqual(evaluating.data.stage, 'edit');
  } finally {
    api.saveRecordDetails = original.api;
    auth.ensureLogin = original.login;
    global.wx = original.wx;
    global.getApp = original.app;
    global.Component = original.component;
  }
});

sequence.then(() => {
  console.log(`\n${count} 组测试全部通过。`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
