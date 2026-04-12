export function classifyOpenRouterKey(key) {
  if (!key || typeof key !== 'string') return 'unknown';
  const trimmed = key.trim();
  if (trimmed.startsWith('sk-or-mgmt-')) return 'management';
  if (trimmed.startsWith('sk-or-')) return 'standard';
  return 'unknown';
}

export function assertManagementKey(key, context = 'operation') {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error(`Management key required for ${context}. No key provided.`);
  }
}

export function assertStandardKey(key, context = 'operation') {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error(`Standard API key required for ${context}. No key provided.`);
  }
}
