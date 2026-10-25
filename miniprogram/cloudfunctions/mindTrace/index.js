'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const {
  AppError,
  badRequest,
  conflict,
  notFound,
  createGeneration,
  isUserDeleting,
  assertActiveUser,
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
  paginate,
  compareNewest,
  buildThoughtItems,
  buildMatches,
  buildStats
} = require('./domain');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const BATCH_SIZE = 100;
const ACTIONS = new Set([
  'login', 'me', 'deleteMe', 'dashboard', 'matchThoughts', 'createRecord',
  'listRecords', 'getRecord', 'patchRecord', 'closeRecord', 'pauseRecord',
  'listThoughts', 'getThought', 'stats'
]);

function nowISO() {
  return new Date().toISOString();
}

function hashID(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function randomID(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

function userID(openid) {
  return hashID('u', openid);
}

function deterministicRecordID(openid, clientRequestId) {
  return hashID('r', `${openid}\0${clientRequestId}`);
}

function publicDoc(document) {
  if (!document) return null;
  const { _id, _openid, ownerOpenid, latestRecordId, openCount, ...fields } = document;
  return { id: _id, ...fields };
}

function isNotFoundError(error) {
  if (!error) return false;
  const code = String(error.errCode === undefined ? error.code : error.errCode).toLowerCase();
  const message = String(error.errMsg || error.message || '').toLowerCase();
  return code === 'document_not_found' || code === 'not_found' ||
    message.includes('document not found') || message.includes('cannot find document') ||
    message.includes('document does not exist') || message.includes('not exist');
}

async function getDocument(collection, id, transaction) {
  const source = transaction || db;
  try {
    const result = await source.collection(collection).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function removeDocument(collection, id) {
  try {
    await db.collection(collection).doc(id).remove();
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

async function getOwnedDocument(collection, id, openid, transaction) {
  const document = await getDocument(collection, id, transaction);
  if (!document || document.ownerOpenid !== openid) return null;
  return document;
}

async function requireUser(openid, actorUserId, transaction) {
  const user = await getOwnedDocument('users', userID(openid), openid, transaction);
  assertActiveUser(user);
  return assertActorUser(user, actorUserId);
}

async function fetchAll(collection, openid) {
  const documents = [];
  let offset = 0;
  // Every batch repeats the owner predicate; client-supplied user IDs are never used.
  while (true) {
    const result = await db.collection(collection)
      .where({ ownerOpenid: openid })
      .skip(offset)
      .limit(BATCH_SIZE)
      .get();
    const batch = result.data || [];
    documents.push(...batch);
    if (batch.length < BATCH_SIZE) break;
    offset += batch.length;
  }
  return documents;
}

async function deleteUserDocuments(openid) {
  const [records, thoughts] = await Promise.all([
    fetchAll('records', openid),
    fetchAll('thoughts', openid)
  ]);
  const documents = [
    ...records.map((item) => ['records', item._id]),
    ...thoughts.map((item) => ['thoughts', item._id])
  ];
  for (let offset = 0; offset < documents.length; offset += 20) {
    await Promise.all(documents.slice(offset, offset + 20).map(([collection, id]) =>
      removeDocument(collection, id)));
  }
}

async function finalizeUserDeletion(openid, generation) {
  await db.runTransaction(async (transaction) => {
    const current = await getOwnedDocument('users', userID(openid), openid, transaction);
    // A delayed cleanup must never remove a subsequently created generation.
    if (!current || !isUserDeleting(current) || current.generation !== generation) return;
    await transaction.collection('users').doc(current._id).remove();
  });
}

async function cleanupDeletingUser(openid, generation) {
  // Bulk reads/writes stay outside transactions; the deleting flag blocks new writes.
  await deleteUserDocuments(openid);
  await finalizeUserDeletion(openid, generation);
}

async function login(openid, payload) {
  const input = normalizeLogin(payload);
  const id = userID(openid);
  while (true) {
    const existing = await getOwnedDocument('users', id, openid);
    if (isUserDeleting(existing)) await cleanupDeletingUser(openid, existing.generation);
    try {
      const user = await db.runTransaction(async (transaction) => {
        let current = await getOwnedDocument('users', id, openid, transaction);
        if (isUserDeleting(current)) {
          throw new AppError(409, 'USER_DELETING', 'user deletion is in progress');
        }
        const timestamp = nowISO();
        if (!current) {
          current = {
            _id: id,
            ownerOpenid: openid,
            generation: createGeneration(),
            deleting: false,
            deletingAt: null,
            nickname: input.nickname || '',
            avatarUrl: input.avatarUrl || '',
            createdAt: timestamp,
            updatedAt: timestamp
          };
          await transaction.collection('users').doc(id).set({ data: current });
        } else {
          const updates = { updatedAt: timestamp };
          if (input.nickname !== undefined) updates.nickname = input.nickname;
          if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl;
          await transaction.collection('users').doc(id).update({ data: updates });
          current = { ...current, ...updates };
        }
        return current;
      });
      return { user: publicUser(user) };
    } catch (error) {
      if (error.code !== 'USER_DELETING') throw error;
      // Another request marked the user after our pre-check; loop and clean outside a transaction.
    }
  }
}

async function markUserDeleting(openid, actorUserId) {
  return db.runTransaction(async (transaction) => {
    let current = await getOwnedDocument('users', userID(openid), openid, transaction);
    // Recovery is allowed only for the same generation; an old delete cannot touch a new account.
    assertActorUser(current, actorUserId);
    if (isUserDeleting(current)) return current;
    const updates = { deleting: true, deletingAt: nowISO(), updatedAt: nowISO() };
    await transaction.collection('users').doc(current._id).update({ data: updates });
    current = { ...current, ...updates };
    return current;
  });
}

async function deleteMe(openid, actorUserId, payload) {
  emptyPayload(payload);
  const user = await markUserDeleting(openid, actorUserId);
  // Repeating deleteMe resumes the same cleanup even after a partial failure.
  await cleanupDeletingUser(openid, user.generation);
  return { deleted: true };
}

async function dashboard(openid) {
  emptyPayload(arguments[1]);
  const [records, thoughts] = await Promise.all([
    fetchAll('records', openid),
    fetchAll('thoughts', openid)
  ]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return {
    todayCount: records.filter((record) => {
      const createdAt = new Date(record.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= start;
    }).length,
    pendingCount: records.filter((record) => record.status !== 'closed').length,
    closedCount: records.filter((record) => record.status === 'closed').length,
    thoughtCount: thoughts.length
  };
}

async function matchThoughts(openid, payload) {
  const value = normalizeMatch(payload);
  const [thoughts, records] = await Promise.all([
    fetchAll('thoughts', openid),
    fetchAll('records', openid)
  ]);
  return {
    items: buildMatches(thoughts, records, value).map((item) => ({
      thought: publicDoc(item.thought),
      score: item.score
    }))
  };
}

async function createRecord(openid, actorUserId, payload) {
  const input = normalizeCreateRecord(payload);
  const recordId = input.clientRequestId === undefined
    ? randomID('r') : deterministicRecordID(openid, input.clientRequestId);
  const newThoughtId = input.thoughtId === undefined ? randomID('t') : null;

  const result = await db.runTransaction(async (transaction) => {
    const user = await requireUser(openid, actorUserId, transaction);
    const existing = await getOwnedDocument('records', recordId, openid, transaction);
    if (existing) {
      const thought = await getOwnedDocument('thoughts', existing.thoughtId, openid, transaction);
      if (!thought) conflict('idempotent record is missing its thought');
      return { thought, record: existing };
    }

    let thought;
    let previous = null;
    if (newThoughtId) {
      thought = {
        _id: newThoughtId,
        ownerOpenid: openid,
        triggerEvent: input.triggerEvent,
        emotions: input.emotions,
        status: 'active',
        versionCount: 0,
        openCount: 0,
        latestRecordId: null,
        createdAt: nowISO(),
        updatedAt: nowISO()
      };
    } else {
      thought = await getOwnedDocument('thoughts', input.thoughtId, openid, transaction);
      if (!thought) notFound();
      if (!Number.isInteger(thought.versionCount) || thought.versionCount < 1 ||
          !Number.isInteger(thought.openCount) || thought.openCount < 0 || !thought.latestRecordId) {
        conflict('thought version metadata is invalid');
      }
      // A direct document read is intentional: multi-record queries are not used in transactions.
      previous = await getOwnedDocument('records', thought.latestRecordId, openid, transaction);
      if (!previous || previous.thoughtId !== thought._id) conflict('latest thought version is unavailable');
    }

    const timestamp = nowISO();
    const record = {
      _id: recordId,
      ownerOpenid: openid,
      thoughtId: thought._id,
      clientRequestId: input.clientRequestId === undefined ? null : input.clientRequestId,
      versionNo: thought.versionCount + 1,
      triggerEvent: input.triggerEvent,
      emotions: input.emotions,
      intensity: input.intensity,
      loopThought: input.loopThought,
      status: 'registered',
      step: 0,
      ruminationType: '',
      riskContent: '',
      probability: null,
      controllableActions: [],
      uncontrollableItems: [],
      scenarioWorst: '',
      scenarioLikely: '',
      scenarioBest: '',
      closeConfirmations: [false, false, false],
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: null
    };
    if (previous) Object.assign(record, inheritEvaluation(previous));

    const versionCount = thought.versionCount + 1;
    const openCount = thought.openCount + 1;
    const thoughtUpdates = {
      triggerEvent: input.triggerEvent,
      emotions: input.emotions,
      status: calculateThoughtStatus(versionCount, openCount),
      versionCount,
      openCount,
      latestRecordId: recordId,
      updatedAt: timestamp
    };
    // Write the user before business documents so delete marking conflicts with every real create.
    await transaction.collection('users').doc(user._id).update({ data: createUserWriteTouch(timestamp) });
    await transaction.collection('records').doc(recordId).set({ data: record });
    if (newThoughtId) {
      await transaction.collection('thoughts').doc(newThoughtId).set({ data: { ...thought, ...thoughtUpdates } });
    } else {
      await transaction.collection('thoughts').doc(thought._id).update({ data: thoughtUpdates });
    }
    return { thought: { ...thought, ...thoughtUpdates }, record };
  });
  return { thought: publicDoc(result.thought), record: publicDoc(result.record) };
}

async function listRecords(openid, payload) {
  const filters = normalizeListRecords(payload);
  const records = await fetchAll('records', openid);
  const filtered = records.filter((record) => !filters.status || record.status === filters.status)
    .sort(compareNewest);
  const result = paginate(filtered, filters.page, filters.pageSize);
  result.items = result.items.map(publicDoc);
  return result;
}

async function getRecord(openid, payload) {
  const id = normalizeRecordId(payload);
  const record = await getOwnedDocument('records', id, openid);
  if (!record) notFound();
  return publicDoc(record);
}

async function patchRecord(openid, payload) {
  const { id, updates } = normalizePatchRecord(payload);
  const record = await db.runTransaction(async (transaction) => {
    const current = await getOwnedDocument('records', id, openid, transaction);
    if (!current) notFound();
    if (current.status === 'closed') conflict('closed records cannot be edited');
    const changes = { ...updates, updatedAt: nowISO() };
    await transaction.collection('records').doc(id).update({ data: changes });
    return { ...current, ...changes };
  });
  return publicDoc(record);
}

async function closeRecord(openid, payload) {
  const id = normalizeRecordId(payload);
  const snapshot = await getOwnedDocument('records', id, openid);
  if (!snapshot) notFound();
  const record = await db.runTransaction(async (transaction) => {
    // Lock the thought first, matching createRecord's thought/version allocation order.
    const thought = await getOwnedDocument('thoughts', snapshot.thoughtId, openid, transaction);
    if (!thought) notFound();
    const current = await getOwnedDocument('records', id, openid, transaction);
    if (!current || current.thoughtId !== thought._id) notFound();
    if (current.status === 'closed') conflict('record is already closed');
    if (!Number.isInteger(thought.versionCount) || !Number.isInteger(thought.openCount) || thought.openCount < 1) {
      conflict('thought version metadata is invalid');
    }
    validateClose(current);
    const timestamp = nowISO();
    const changes = { status: 'closed', step: 7, closedAt: timestamp, updatedAt: timestamp };
    const openCount = thought.openCount - 1;
    const thoughtChanges = {
      openCount,
      status: calculateThoughtStatus(thought.versionCount, openCount),
      updatedAt: timestamp
    };
    await transaction.collection('records').doc(id).update({ data: changes });
    await transaction.collection('thoughts').doc(thought._id).update({ data: thoughtChanges });
    return { ...current, ...changes };
  });
  return publicDoc(record);
}

async function pauseRecord(openid, payload) {
  const id = normalizeRecordId(payload);
  const record = await db.runTransaction(async (transaction) => {
    const current = await getOwnedDocument('records', id, openid, transaction);
    if (!current) notFound();
    if (current.status === 'closed') conflict('closed records cannot be paused');
    const changes = { status: 'paused', updatedAt: nowISO() };
    await transaction.collection('records').doc(id).update({ data: changes });
    return { ...current, ...changes };
  });
  return publicDoc(record);
}

async function listThoughts(openid, payload) {
  const filters = normalizeListThoughts(payload);
  const [thoughts, records] = await Promise.all([
    fetchAll('thoughts', openid),
    fetchAll('records', openid)
  ]);
  const items = buildThoughtItems(thoughts, records, filters);
  const result = paginate(items, filters.page, filters.pageSize);
  result.items = result.items.map((item) => ({
    thought: publicDoc(item.thought),
    versionCount: item.versionCount,
    latestRecord: publicDoc(item.latestRecord),
    currentStep: item.currentStep,
    currentStatus: item.currentStatus
  }));
  return result;
}

async function getThought(openid, payload) {
  const id = normalizeRecordId(payload);
  const thought = await getOwnedDocument('thoughts', id, openid);
  if (!thought) notFound();
  const records = await fetchAll('records', openid);
  const versions = records.filter((record) => record.thoughtId === id)
    .sort((left, right) => right.versionNo - left.versionNo)
    .map(publicDoc);
  return { thought: publicDoc(thought), records: versions };
}

async function stats(openid, payload) {
  emptyPayload(arguments[1]);
  const [thoughts, records] = await Promise.all([
    fetchAll('thoughts', openid),
    fetchAll('records', openid)
  ]);
  return buildStats(thoughts, records);
}

async function dispatch(action, openid, actorUserId, payload) {
  if (action === 'login') return login(openid, payload);
  // deleteMe permits deleting users, but still enforces the actor's exact generation.
  if (action === 'deleteMe') return deleteMe(openid, actorUserId, payload);
  const user = await requireUser(openid, actorUserId);
  switch (action) {
    case 'me': emptyPayload(payload); return publicUser(user);
    case 'dashboard': return dashboard(openid, payload);
    case 'matchThoughts': return matchThoughts(openid, payload);
    case 'createRecord': return createRecord(openid, actorUserId, payload);
    case 'listRecords': return listRecords(openid, payload);
    case 'getRecord': return getRecord(openid, payload);
    case 'patchRecord': return patchRecord(openid, payload);
    case 'closeRecord': return closeRecord(openid, payload);
    case 'pauseRecord': return pauseRecord(openid, payload);
    case 'listThoughts': return listThoughts(openid, payload);
    case 'getThought': return getThought(openid, payload);
    case 'stats': return stats(openid, payload);
    default: badRequest('unsupported action');
  }
}

exports.main = async (event = {}) => {
  try {
    const action = event.action;
    if (typeof action !== 'string' || !ACTIONS.has(action)) badRequest('unsupported action');
    const { OPENID: openid } = cloud.getWXContext();
    if (typeof openid !== 'string' || !openid) {
      throw new AppError(401, 'UNAUTHORIZED', 'wechat identity is unavailable');
    }
    const payload = event.payload === undefined ? {} : event.payload;
    return { data: await dispatch(action, openid, event.actorUserId, payload) };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: { code: error.code, message: error.message, statusCode: error.status } };
    }
    console.error('mindTrace invocation failed', error);
    return { error: { code: 'INTERNAL_ERROR', message: 'service unavailable', statusCode: 500 } };
  }
};
