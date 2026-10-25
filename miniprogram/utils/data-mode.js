function normalizeDataMode(mode) {
  if (mode === 'cloud' || mode === 'http') return mode;
  throw new Error('DATA_MODE 仅支持 cloud 或 http');
}

function selectTransport(mode, transports) {
  const normalized = normalizeDataMode(mode);
  const transport = transports && transports[normalized];
  if (typeof transport !== 'function') throw new Error(`${normalized} 传输层不可用`);
  return transport;
}

module.exports = { normalizeDataMode, selectTransport };
