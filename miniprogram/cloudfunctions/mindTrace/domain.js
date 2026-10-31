'use strict';

const crypto = require('crypto');

const RECORD_STATUSES = new Set(['registered', 'evaluating', 'paused', 'closed']);
const THOUGHT_STATUSES = new Set(['active', 'resolved', 'recurring']);
const RECURRING_VERSION_THRESHOLD = 3;

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

function badRequest(message) {
  throw new AppError(400, 'INVALID_INPUT', message);
}

function conflict(message) {
  throw new AppError(409, 'CONFLICT', message);
}

function notFound() {
  throw new AppError(404, 'NOT_FOUND', 'resource not found');
}

function createGeneration() {
  return crypto.randomBytes(16).toString('hex');
}

function isUserDeleting(user) {
  return Boolean(user && user.deleting === true);
}

function assertActiveUser(user) {
  if (!user || isUserDeleting(user)) {
    throw new AppError(401, 'UNAUTHORIZED', 'user is not logged in');
  }
  return user;
}

function publicUserID(user) {
  return `${user._id}:${user.generation}`;
}

function assertActorUser(user, actorUserId) {
  if (!user || typeof actorUserId !== 'string' || actorUserId !== publicUserID(user)) {
    throw new AppError(401, 'UNAUTHORIZED', 'actor user generation is invalid');
  }
  return user;
}

function createUserWriteTouch(timestamp) {
  return { lastWriteAt: timestamp, updatedAt: timestamp };
}

function publicUser(user) {
  if (!user) return null;
  const { _id, generation, deleting, deletingAt, _openid, ownerOpenid, ...fields } = user;
  return { id: publicUserID(user), ...fields };
}

function assertObject(value, name = 'payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    badRequest(`${name} must be an object`);
  }
  return value;
}

function assertAllowed(value, fields) {
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) badRequest(`unknown field: ${key}`);
  }
}

function text(value, name, min, max, trim = true) {
  if (typeof value !== 'string') badRequest(`${name} must be a string`);
  const normalized = trim ? value.trim() : value;
  const length = Array.from(normalized.trim()).length;
  if (length < min || length > max) {
    badRequest(`${name} length is outside the allowed range`);
  }
  return normalized;
}

function optionalText(value, name, max) {
  if (value === undefined) return undefined;
  return text(value, name, 0, max);
}

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    badRequest(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function identifier(value, name = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    badRequest(`${name} must be a valid identifier`);
  }
  return value;
}

function validateEmotions(value) {
  if (!Array.isArray(value)) badRequest('emotions must be an array');
  if (value.length > 20) badRequest('at most 20 emotions are allowed');
  return value.map((item) => text(item, 'emotion', 1, 30));
}

function validateActions(value) {
  if (!Array.isArray(value)) badRequest('controllableActions must be an array');
  if (value.length > 100) badRequest('too many controllableActions');
  return value.map((item) => {
    assertObject(item, 'controllable action');
    assertAllowed(item, ['text', 'done']);
    if (typeof item.done !== 'boolean') badRequest('action done must be a boolean');
    return { text: text(item.text, 'action text', 1, 500), done: item.done };
  });
}

function validateUncontrollable(value) {
  if (!Array.isArray(value)) badRequest('uncontrollableItems must be an array');
  if (value.length > 100) badRequest('too many uncontrollableItems');
  return value.map((item) => {
    assertObject(item, 'uncontrollable item');
    assertAllowed(item, ['text', 'crossedOut']);
    if (typeof item.crossedOut !== 'boolean') badRequest('uncontrollable item crossedOut must be a boolean');
    return { text: text(item.text, 'uncontrollable item text', 1, 500), crossedOut: item.crossedOut };
  });
}

function validateConfirmations(value) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'boolean')) {
    badRequest('closeConfirmations must contain exactly three booleans');
  }
  return value.slice();
}

function emptyPayload(payload) {
  const value = assertObject(payload);
  assertAllowed(value, []);
  return value;
}

function normalizeLogin(payload) {
  const value = assertObject(payload);
  assertAllowed(value, ['nickname', 'avatarUrl']);
  return {
    nickname: optionalText(value.nickname, 'nickname', 100),
    avatarUrl: optionalText(value.avatarUrl, 'avatarUrl', 1024)
  };
}

function normalizeCreateRecord(payload) {
  const value = assertObject(payload);
  assertAllowed(value, ['thoughtId', 'clientRequestId', 'triggerEvent', 'emotions', 'intensity', 'loopThought']);
  const result = {
    triggerEvent: text(value.triggerEvent, 'triggerEvent', 1, 100),
    emotions: value.emotions === undefined ? [] : validateEmotions(value.emotions),
    intensity: value.intensity === undefined || value.intensity === null
      ? null : integer(value.intensity, 'intensity', 1, 10),
    loopThought: text(value.loopThought, 'loopThought', 1, 1000)
  };
  if (value.thoughtId !== undefined) result.thoughtId = identifier(value.thoughtId, 'thoughtId');
  if (value.clientRequestId !== undefined) {
    result.clientRequestId = text(value.clientRequestId, 'clientRequestId', 1, 64);
  }
  return result;
}

function normalizeId(payload, extraFields = []) {
  const value = assertObject(payload);
  assertAllowed(value, ['id', ...extraFields]);
  return value;
}

function normalizeRecordId(payload) {
  return identifier(normalizeId(payload).id);
}

function normalizePage(value) {
  const page = value.page === undefined ? 1 : integer(value.page, 'page', 1, Number.MAX_SAFE_INTEGER);
  const pageSize = value.pageSize === undefined ? 20 : integer(value.pageSize, 'pageSize', 1, 100);
  return { page, pageSize };
}

function normalizeListRecords(payload) {
  const value = assertObject(payload);
  assertAllowed(value, ['status', 'page', 'pageSize']);
  if (value.status !== undefined && value.status !== '' &&
      (typeof value.status !== 'string' || !RECORD_STATUSES.has(value.status))) {
    badRequest('invalid record status');
  }
  return { status: value.status || '', ...normalizePage(value) };
}

function normalizeListThoughts(payload) {
  const value = assertObject(payload);
  assertAllowed(value, ['query', 'status', 'emotion', 'page', 'pageSize']);
  const query = value.query === undefined ? '' : text(value.query, 'query', 0, 200);
  const emotion = value.emotion === undefined ? '' : text(value.emotion, 'emotion', 0, 30);
  if (value.status !== undefined && value.status !== '' &&
      (typeof value.status !== 'string' || !THOUGHT_STATUSES.has(value.status))) {
    badRequest('invalid thought status');
  }
  return { query, status: value.status || '', emotion, ...normalizePage(value) };
}

function normalizeMatch(payload) {
  const value = assertObject(payload);
  assertAllowed(value, ['text']);
  return text(value.text, 'text', 1, 1000);
}

function normalizePatchRecord(payload) {
  const value = normalizeId(payload, [
    'step', 'status', 'ruminationType', 'riskContent', 'probability',
    'controllableActions', 'uncontrollableItems', 'scenarioWorst',
    'scenarioLikely', 'scenarioBest', 'closeConfirmations', 'emotions', 'intensity'
  ]);
  const id = identifier(value.id);
  const updates = {};
  if (value.emotions !== undefined) updates.emotions = validateEmotions(value.emotions);
  if (value.intensity !== undefined) {
    updates.intensity = value.intensity === null ? null : integer(value.intensity, 'intensity', 1, 10);
  }
  if (value.step !== undefined) updates.step = integer(value.step, 'step', 0, 7);
  if (value.status !== undefined) {
    if (value.status === 'closed') badRequest('use the close endpoint to close a record');
    if (typeof value.status !== 'string' || !RECORD_STATUSES.has(value.status)) badRequest('invalid record status');
    updates.status = value.status;
  }
  for (const [name, max] of [
    ['ruminationType', 100], ['riskContent', 2000], ['scenarioWorst', 2000],
    ['scenarioLikely', 2000], ['scenarioBest', 2000]
  ]) {
    if (value[name] !== undefined) updates[name] = text(value[name], name, 0, max);
  }
  if (value.probability !== undefined) updates.probability = integer(value.probability, 'probability', 0, 100);
  if (value.controllableActions !== undefined) updates.controllableActions = validateActions(value.controllableActions);
  if (value.uncontrollableItems !== undefined) updates.uncontrollableItems = validateUncontrollable(value.uncontrollableItems);
  if (value.closeConfirmations !== undefined) updates.closeConfirmations = validateConfirmations(value.closeConfirmations);
  if (Object.keys(updates).length === 0) badRequest('no fields to update');
  return { id, updates };
}

function validateClose(record) {
  text(record.ruminationType || '', 'ruminationType', 1, 100);
  text(record.riskContent || '', 'riskContent', 1, 2000);
  if (!Number.isInteger(record.probability) || record.probability < 0 || record.probability > 100) {
    badRequest('probability is required and must be between 0 and 100');
  }
  if (!Array.isArray(record.controllableActions) || record.controllableActions.length === 0 ||
      !Array.isArray(record.uncontrollableItems) || record.uncontrollableItems.length === 0) {
    badRequest('controllableActions and uncontrollableItems are required');
  }
  validateActions(record.controllableActions);
  validateUncontrollable(record.uncontrollableItems);
  for (const name of ['scenarioWorst', 'scenarioLikely', 'scenarioBest']) {
    text(record[name] || '', name, 1, 2000);
  }
  const confirmations = validateConfirmations(record.closeConfirmations);
  if (confirmations.some((item) => item !== true)) badRequest('all three close confirmations must be true');
}

function calculateThoughtStatus(versionCount, openCount) {
  if (versionCount >= RECURRING_VERSION_THRESHOLD) return 'recurring';
  if (versionCount > 0 && openCount === 0) return 'resolved';
  return 'active';
}

function inheritEvaluation(previous) {
  return {
    ruminationType: previous.ruminationType || '',
    riskContent: previous.riskContent || '',
    probability: previous.probability === undefined ? null : previous.probability,
    controllableActions: JSON.parse(JSON.stringify(previous.controllableActions || [])),
    uncontrollableItems: JSON.parse(JSON.stringify(previous.uncontrollableItems || [])),
    scenarioWorst: previous.scenarioWorst || '',
    scenarioLikely: previous.scenarioLikely || '',
    scenarioBest: previous.scenarioBest || '',
    closeConfirmations: [false, false, false]
  };
}

function tokens(value) {
  const result = new Set();
  let word = '';
  let cjk = '';
  const flushWord = () => {
    if (word) result.add(word);
    word = '';
  };
  const flushCJK = () => {
    if (cjk.length === 1) result.add(cjk);
    for (let index = 0; index + 1 < cjk.length; index += 1) result.add(cjk.slice(index, index + 2));
    cjk = '';
  };
  for (const character of value.toLowerCase().trim()) {
    if (/\p{Script=Han}/u.test(character)) {
      flushWord();
      cjk += character;
    } else if (/[\p{L}\p{N}]/u.test(character)) {
      flushCJK();
      word += character;
    } else {
      flushWord();
      flushCJK();
    }
  }
  flushWord();
  flushCJK();
  return result;
}

function similarity(left, right) {
  const a = tokens(String(left || ''));
  const b = tokens(String(right || ''));
  if (a.size === 0 || b.size === 0) return 0;
  const counts = new Map();
  for (const token of a) counts.set(token, (counts.get(token) || 0) + 1);
  let intersection = 0;
  for (const token of b) {
    if ((counts.get(token) || 0) > 0) {
      intersection += 1;
      counts.set(token, counts.get(token) - 1);
    }
  }
  return 2 * intersection / (a.size + b.size);
}

function paginate(items, page, pageSize) {
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize
  };
}

function compareNewest(left, right) {
  const time = String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
  return time || String(left._id || left.id).localeCompare(String(right._id || right.id));
}

function compareThoughts(left, right) {
  const time = String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  return time || String(left._id || left.id).localeCompare(String(right._id || right.id));
}

function buildThoughtItems(thoughts, records, filters) {
  const query = filters.query.toLowerCase();
  const byThought = new Map();
  for (const record of records) {
    if (!byThought.has(record.thoughtId)) byThought.set(record.thoughtId, []);
    byThought.get(record.thoughtId).push(record);
  }
  const items = [];
  for (const thought of thoughts) {
    if (filters.status && thought.status !== filters.status) continue;
    if (filters.emotion && !(thought.emotions || []).includes(filters.emotion)) continue;
    const versions = (byThought.get(thought._id || thought.id) || []).sort((a, b) => b.versionNo - a.versionNo);
    if (query) {
      const inThought = String(thought.triggerEvent || '').toLowerCase().includes(query);
      const inRecord = versions.some((record) => [record.triggerEvent, record.loopThought, record.riskContent]
        .some((field) => String(field || '').toLowerCase().includes(query)));
      if (!inThought && !inRecord) continue;
    }
    const latest = versions[0] || null;
    items.push({
      thought,
      versionCount: versions.length,
      latestRecord: latest,
      currentStep: latest ? latest.step : 0,
      currentStatus: latest ? latest.status : 'registered'
    });
  }
  items.sort((left, right) => compareThoughts(left.thought, right.thought));
  return items;
}

function buildMatches(thoughts, records, value) {
  const byThought = new Map();
  for (const record of records) {
    if (!byThought.has(record.thoughtId)) byThought.set(record.thoughtId, []);
    byThought.get(record.thoughtId).push(record);
  }
  const items = [];
  for (const thought of thoughts) {
    const id = thought._id || thought.id;
    let score = similarity(value, thought.triggerEvent);
    for (const record of byThought.get(id) || []) {
      const candidate = similarity(value, `${record.triggerEvent || ''} ${record.loopThought || ''} ${record.riskContent || ''}`);
      if (candidate > score) score = candidate;
    }
    if (score >= 0.15) items.push({ thought, score: Math.round(score * 10000) / 10000 });
  }
  items.sort((left, right) => right.score - left.score ||
    String(left.thought._id || left.thought.id).localeCompare(String(right.thought._id || right.thought.id)));
  return items.slice(0, 20);
}

function localDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildStats(thoughts, records, now = new Date()) {
  const closedRecords = records.filter((record) => record.status === 'closed').length;
  const emotionCounts = {};
  for (const thought of thoughts) {
    for (const emotion of thought.emotions || []) emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
  }
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  since.setDate(since.getDate() - 29);
  const daily = new Map();
  for (const record of records) {
    if (!Number.isInteger(record.intensity) || record.intensity < 1 || record.intensity > 10) continue;
    const createdAt = new Date(record.createdAt);
    if (Number.isNaN(createdAt.getTime()) || createdAt < since) continue;
    const date = localDay(createdAt);
    const current = daily.get(date) || { sum: 0, count: 0 };
    current.sum += record.intensity;
    current.count += 1;
    daily.set(date, current);
  }
  const intensityTrend = Array.from(daily, ([date, value]) => ({
    date,
    avgIntensity: value.sum / value.count
  })).sort((left, right) => left.date.localeCompare(right.date));
  const versionCounts = new Map();
  for (const record of records) {
    versionCounts.set(record.thoughtId, (versionCounts.get(record.thoughtId) || 0) + 1);
  }
  return {
    totalThoughts: thoughts.length,
    totalRecords: records.length,
    closedRecords,
    completionRate: records.length ? closedRecords / records.length : 0,
    recurringThoughts: thoughts.filter((thought) =>
      (versionCounts.get(thought._id || thought.id) || 0) >= RECURRING_VERSION_THRESHOLD).length,
    emotionCounts,
    intensityTrend
  };
}

module.exports = {
  AppError,
  RECURRING_VERSION_THRESHOLD,
  badRequest,
  conflict,
  notFound,
  createGeneration,
  isUserDeleting,
  assertActiveUser,
  publicUserID,
  assertActorUser,
  createUserWriteTouch,
  publicUser,
  emptyPayload,
  normalizeLogin,
  normalizeCreateRecord,
  normalizeRecordId,
  normalizeListRecords,
  normalizeListThoughts,
  normalizeMatch,
  normalizePatchRecord,
  validateClose,
  calculateThoughtStatus,
  inheritEvaluation,
  similarity,
  paginate,
  compareNewest,
  buildThoughtItems,
  buildMatches,
  buildStats
};
