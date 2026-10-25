function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateQuick(form) {
  const triggerEvent = trimmed(form.triggerEvent);
  const loopThought = trimmed(form.loopThought);
  const intensity = Number(form.intensity);
  if (!triggerEvent) return '请写下触发这件事的场景';
  if (triggerEvent.length > 100) return '触发事件不能超过 100 字';
  if (!Array.isArray(form.emotions) || !form.emotions.length) return '请至少选择一种情绪';
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) return '情绪强度需为 1–10';
  if (!loopThought) return '请原话写下循环念头';
  if (loopThought.length > 1000) return '循环念头不能超过 1000 字';
  return '';
}

function cleanLines(value) {
  return String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
}

function evaluationStepError(step, form) {
  if (step === 1 && !form.ruminationType) return '请选择本次判断';
  if (step === 2 && !trimmed(form.riskContent)) return '请写下具体担心什么会出错';
  if (step === 3 && (Number(form.probability) < 0 || Number(form.probability) > 100)) return '概率需在 0–100 之间';
  if (step === 4 && !cleanLines(form.actionsText).length) return '请至少写下一项可控行动';
  if (step === 5 && !cleanLines(form.uncontrollableText).length) return '请至少写下一项不可控内容';
  if (step === 6 && (!trimmed(form.scenarioWorst) || !trimmed(form.scenarioLikely) || !trimmed(form.scenarioBest))) {
    return '最坏、最可能、最好三种视角都需要填写';
  }
  if (step === 7 && (!Array.isArray(form.closeConfirmations) || form.closeConfirmations.length !== 3 || form.closeConfirmations.some((item) => !item))) {
    return '请逐项完成三项收尾确认';
  }
  return '';
}

function buildEvaluationPayload(form, step) {
  return {
    step,
    status: step > 0 ? 'evaluating' : 'registered',
    ruminationType: form.ruminationType || '',
    riskContent: trimmed(form.riskContent),
    probability: Number(form.probability),
    controllableActions: cleanLines(form.actionsText).map((text, index) => ({
      text,
      done: Boolean((form.actionsDone || [])[index])
    })),
    uncontrollableItems: cleanLines(form.uncontrollableText).map((text, index) => ({
      text,
      crossedOut: Boolean((form.crossedOut || [])[index])
    })),
    scenarioWorst: trimmed(form.scenarioWorst),
    scenarioLikely: trimmed(form.scenarioLikely),
    scenarioBest: trimmed(form.scenarioBest),
    closeConfirmations: [0, 1, 2].map((index) => Boolean((form.closeConfirmations || [])[index]))
  };
}

module.exports = { trimmed, cleanLines, validateQuick, evaluationStepError, buildEvaluationPayload };
