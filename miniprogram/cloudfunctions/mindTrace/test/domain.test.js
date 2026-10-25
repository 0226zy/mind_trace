'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AppError,
  createGeneration,
  isUserDeleting,
  assertActiveUser,
  publicUserID,
  assertActorUser,
  createUserWriteTouch,
  publicUser,
  normalizeCreateRecord,
  normalizePatchRecord,
  normalizeListRecords,
  normalizeListThoughts,
  validateClose,
  calculateThoughtStatus,
  inheritEvaluation,
  similarity,
  paginate,
  buildThoughtItems,
  buildMatches,
  buildStats
} = require('../domain');

function completeRecord() {
  return {
    ruminationType: '灾难化',
    riskContent: '担心被辞退',
    probability: 0,
    controllableActions: [{ text: '核对事实', done: true }],
    uncontrollableItems: [{ text: '他人的想法', crossedOut: true }],
    scenarioWorst: '失去工作',
    scenarioLikely: '修正错误',
    scenarioBest: '顺利完成',
    closeConfirmations: [true, true, true]
  };
}

function expectBadRequest(fn) {
  assert.throws(fn, (error) => error instanceof AppError && error.status === 400 && error.code === 'INVALID_INPUT');
}

test('用户 generation 随机且公开 ID 包含代次但不泄露内部字段', () => {
  const first = createGeneration();
  const second = createGeneration();
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.notEqual(first, second);
  const raw = {
    _id: 'u_fixed', generation: first, ownerOpenid: 'owner-secret', _openid: 'reserved-secret',
    deleting: false, deletingAt: null, nickname: '止念用户', avatarUrl: '', createdAt: '2026-01-01T00:00:00.000Z'
  };
  const result = publicUser(raw);
  assert.equal(result.id, `u_fixed:${first}`);
  assert.equal(publicUser({ ...raw, generation: second }).id, `u_fixed:${second}`);
  assert.notEqual(result.id, publicUser({ ...raw, generation: second }).id);
  for (const field of ['generation', 'ownerOpenid', '_openid', 'deleting', 'deletingAt', '_id']) {
    assert.equal(Object.hasOwn(result, field), false);
  }
  assert.equal(result.nickname, '止念用户');
});

test('deleting 或缺失用户不能通过普通业务鉴权', () => {
  const active = { _id: 'u_1', deleting: false };
  assert.equal(assertActiveUser(active), active);
  assert.equal(isUserDeleting(active), false);
  assert.equal(isUserDeleting({ ...active, deleting: true }), true);
  for (const user of [null, undefined, { ...active, deleting: true }]) {
    assert.throws(() => assertActiveUser(user), (error) =>
      error instanceof AppError && error.status === 401 && error.code === 'UNAUTHORIZED');
  }
});

test('actorUserId 必须匹配当前 generation，删除恢复也只允许同代次', () => {
  const user = { _id: 'u_fixed', generation: 'generation-new', deleting: true };
  assert.equal(publicUserID(user), 'u_fixed:generation-new');
  assert.equal(assertActorUser(user, 'u_fixed:generation-new'), user);
  for (const actor of [undefined, null, '', 'u_fixed:generation-old', 'u_other:generation-new', 42]) {
    assert.throws(() => assertActorUser(user, actor), (error) =>
      error instanceof AppError && error.status === 401 && error.code === 'UNAUTHORIZED');
  }
  assert.throws(() => assertActorUser(null, 'u_fixed:generation-new'), (error) => error.status === 401);
});

test('登记用户触碰同时更新 lastWriteAt 和 updatedAt', () => {
  const timestamp = '2026-10-25T01:02:03.004Z';
  assert.deepEqual(createUserWriteTouch(timestamp), {
    lastWriteAt: timestamp,
    updatedAt: timestamp
  });
});

test('快速登记校验中文字符长度、整数强度与情绪', () => {
  const input = normalizeCreateRecord({
    clientRequestId: ' request-1 ',
    triggerEvent: ` ${'事'.repeat(100)} `,
    emotions: ['焦虑'],
    intensity: 10,
    loopThought: '反复担心'
  });
  assert.equal(input.clientRequestId, 'request-1');
  assert.equal(input.triggerEvent.length, 100);
  expectBadRequest(() => normalizeCreateRecord({ triggerEvent: '事'.repeat(101), emotions: [], intensity: 1, loopThought: '想' }));
  expectBadRequest(() => normalizeCreateRecord({ triggerEvent: '事', emotions: [], intensity: 1.5, loopThought: '想' }));
  expectBadRequest(() => normalizeCreateRecord({ triggerEvent: '事', emotions: [], intensity: 0, loopThought: '想' }));
  expectBadRequest(() => normalizeCreateRecord({ triggerEvent: '事', emotions: [], intensity: 1, loopThought: '想', openid: 'forged' }));
});

test('草稿严格校验并禁止通过 patch 收尾', () => {
  const patched = normalizePatchRecord({
    id: 'r_1', step: 7, status: 'evaluating', probability: 0,
    controllableActions: [{ text: '行动', done: false }],
    uncontrollableItems: [{ text: '天气', crossedOut: false }],
    closeConfirmations: [true, false, true]
  });
  assert.equal(patched.updates.probability, 0);
  assert.equal(patched.updates.closeConfirmations.length, 3);
  expectBadRequest(() => normalizePatchRecord({ id: 'r_1', status: 'closed' }));
  expectBadRequest(() => normalizePatchRecord({ id: 'r_1', step: 8 }));
  expectBadRequest(() => normalizePatchRecord({ id: 'r_1', probability: 101 }));
  expectBadRequest(() => normalizePatchRecord({ id: 'r_1', closeConfirmations: [true, true] }));
  expectBadRequest(() => normalizePatchRecord({ id: 'r_1' }));
  expectBadRequest(() => normalizePatchRecord({ id: 'r_1', step: 1, userId: 'forged' }));
});

test('分页默认 20 且上限 100，状态值受约束', () => {
  assert.deepEqual(normalizeListRecords({}), { status: '', page: 1, pageSize: 20 });
  assert.equal(normalizeListRecords({ pageSize: 100 }).pageSize, 100);
  expectBadRequest(() => normalizeListRecords({ pageSize: 101 }));
  expectBadRequest(() => normalizeListRecords({ page: 0 }));
  expectBadRequest(() => normalizeListRecords({ status: 'deleted' }));
  expectBadRequest(() => normalizeListThoughts({ status: 'closed' }));
  assert.deepEqual(paginate([1, 2, 3], 2, 2), { items: [3], total: 3, page: 2, pageSize: 2 });
});

test('思虑状态在三版时进入 recurring，全部收尾且不足三版为 resolved', () => {
  assert.equal(calculateThoughtStatus(0, 0), 'active');
  assert.equal(calculateThoughtStatus(1, 1), 'active');
  assert.equal(calculateThoughtStatus(1, 0), 'resolved');
  assert.equal(calculateThoughtStatus(2, 0), 'resolved');
  assert.equal(calculateThoughtStatus(3, 0), 'recurring');
  assert.equal(calculateThoughtStatus(4, 2), 'recurring');
});

test('复发继承评估但深拷贝数组并重置确认', () => {
  const previous = completeRecord();
  const inherited = inheritEvaluation(previous);
  assert.equal(inherited.probability, 0);
  assert.deepEqual(inherited.closeConfirmations, [false, false, false]);
  assert.deepEqual(inherited.controllableActions, previous.controllableActions);
  inherited.controllableActions[0].text = '修改新版本';
  assert.equal(previous.controllableActions[0].text, '核对事实');
});

test('收尾要求完整内容和三项确认，允许 probability 为 0', () => {
  assert.doesNotThrow(() => validateClose(completeRecord()));
  for (const field of ['ruminationType', 'riskContent', 'scenarioWorst', 'scenarioLikely', 'scenarioBest']) {
    const record = completeRecord();
    record[field] = ' ';
    expectBadRequest(() => validateClose(record));
  }
  for (const field of ['controllableActions', 'uncontrollableItems']) {
    const record = completeRecord();
    record[field] = [];
    expectBadRequest(() => validateClose(record));
  }
  const unconfirmed = completeRecord();
  unconfirmed.closeConfirmations = [true, false, true];
  expectBadRequest(() => validateClose(unconfirmed));
  const missingProbability = completeRecord();
  missingProbability.probability = null;
  expectBadRequest(() => validateClose(missingProbability));
});

test('相似度支持中文二元词与英文词边界', () => {
  assert.equal(similarity('担心工作失误', '担心工作失误'), 1);
  assert.equal(similarity('担心工作失误', '喜欢蓝天白云'), 0);
  assert.equal(similarity('Dead Anxiety', 'dead anxiety'), 1);
  assert.equal(similarity('cat', 'concatenate'), 0);
  assert.ok(similarity('担心工作失误被批评', '我害怕工作失误') >= 0.15);
  assert.equal(similarity('明天汇报失败怎么办', '汇报做错会被开除'), similarity('汇报做错会被开除', '明天汇报失败怎么办'));
});

test('思虑检索覆盖触发、念头与风险并组合情绪过滤', () => {
  const thoughts = [
    { _id: 't_1', triggerEvent: '工作汇报', emotions: ['焦虑'], status: 'active', updatedAt: '2026-01-01T00:00:00.000Z' },
    { _id: 't_2', triggerEvent: '社交活动', emotions: ['紧张'], status: 'active', updatedAt: '2026-01-02T00:00:00.000Z' },
    { _id: 't_3', triggerEvent: '健康检查', emotions: ['担忧'], status: 'active', updatedAt: '2026-01-03T00:00:00.000Z' }
  ];
  const records = [
    { thoughtId: 't_1', versionNo: 1, triggerEvent: '工作汇报', loopThought: '一定出错', riskContent: '', status: 'registered', step: 0 },
    { thoughtId: 't_2', versionNo: 1, triggerEvent: '社交活动', loopThought: '独特念头', riskContent: '', status: 'registered', step: 0 },
    { thoughtId: 't_3', versionNo: 1, triggerEvent: '健康检查', loopThought: '等待结果', riskContent: '特殊风险', status: 'registered', step: 0 }
  ];
  const base = { status: '', emotion: '' };
  assert.equal(buildThoughtItems(thoughts, records, { ...base, query: '工作汇报' })[0].thought._id, 't_1');
  assert.equal(buildThoughtItems(thoughts, records, { ...base, query: '独特念头' })[0].thought._id, 't_2');
  assert.equal(buildThoughtItems(thoughts, records, { ...base, query: '特殊风险' })[0].thought._id, 't_3');
  assert.equal(buildThoughtItems(thoughts, records, { ...base, query: '', emotion: '焦虑' }).length, 1);
});

test('匹配读取全部版本并按分数排序，最多返回 20 条', () => {
  const thoughts = Array.from({ length: 25 }, (_, index) => ({ _id: `t_${index}`, triggerEvent: `思虑${index}` }));
  const records = thoughts.map((thought, index) => ({
    thoughtId: thought._id,
    triggerEvent: '',
    loopThought: index === 24 ? '完全相同的目标文本' : '',
    riskContent: ''
  }));
  const matches = buildMatches(thoughts, records, '完全相同的目标文本');
  assert.equal(matches[0].thought._id, 't_24');
  assert.equal(matches[0].score, 1);
  assert.ok(matches.length <= 20);
});

test('统计包含 avgIntensity、完成率、情绪及三版复发，可处理超过 100 条数据', () => {
  const thoughts = [
    { _id: 't_1', emotions: ['焦虑', '紧张'] },
    { _id: 't_2', emotions: ['焦虑'] }
  ];
  const records = Array.from({ length: 205 }, (_, index) => ({
    thoughtId: index < 3 ? 't_1' : 't_2',
    status: index === 0 ? 'closed' : 'registered',
    intensity: index === 0 ? 4 : 8,
    createdAt: index < 2 ? '2026-10-25T01:00:00.000Z' : '2026-10-24T01:00:00.000Z'
  }));
  const result = buildStats(thoughts, records, new Date('2026-10-25T12:00:00.000Z'));
  assert.equal(result.totalRecords, 205);
  assert.equal(result.closedRecords, 1);
  assert.equal(result.completionRate, 1 / 205);
  assert.equal(result.recurringThoughts, 2);
  assert.deepEqual(result.emotionCounts, { 焦虑: 2, 紧张: 1 });
  const point = result.intensityTrend.find((item) => item.date === '2026-10-25');
  assert.equal(point.avgIntensity, 6);
  assert.ok(result.intensityTrend.every((item) => Object.hasOwn(item, 'avgIntensity')));
});
