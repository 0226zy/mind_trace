function emptyQuickForm() {
  return { triggerEvent: '', emotions: [], intensity: 5, loopThought: '' };
}

function deletionResetState(deletionEpoch) {
  return {
    stage: 'edit',
    form: emptyQuickForm(),
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

module.exports = { emptyQuickForm, deletionResetState };
