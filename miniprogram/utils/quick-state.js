function emptyQuickForm() {
  return { triggerEvent: '', emotions: [], intensity: null, loopThought: '' };
}

function buildQuickPayload(form, clientRequestId) {
  const loopThought = typeof form.loopThought === 'string' ? form.loopThought.trim() : '';
  const firstLine = loopThought.split(/\r?\n/).find((line) => line.trim()) || '';
  const triggerEvent = Array.from(firstLine.trim()).slice(0, 100).join('');
  return { triggerEvent, emotions: [], intensity: null, loopThought, clientRequestId };
}

function deletionResetState(deletionEpoch) {
  return {
    stage: 'edit',
    form: emptyQuickForm(),
    canSubmit: false,
    result: null,
    similarItems: [],
    offlineSaved: false,
    restored: false,
    submitting: false,
    error: '',
    matchError: '',
    deletionEpoch
  };
}

module.exports = { emptyQuickForm, buildQuickPayload, deletionResetState };
