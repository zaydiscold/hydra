const REDACTION_RULES = Object.freeze([
  {
    pattern: /\bsk-(?:hydra|proj|or-v1)-[A-Za-z0-9_.-]{8,}\b/gi,
    replacement: '[REDACTED_KEY]',
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    pattern: /((?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    pattern: /(\bbearer\s+)[A-Za-z0-9._~-]{12,}/gi,
    replacement: '$1[REDACTED]',
  },
  {
    pattern: /(\b(?:hydra_token|__session)=)[^;\s]+/gi,
    replacement: '$1[REDACTED]',
  },
]);

/**
 * Redact credential shapes that may appear in logs, error stacks, or support
 * diagnostics. This is a final output boundary, not a substitute for avoiding
 * secret-bearing log calls in the first place.
 */
export function redactSensitiveText(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  for (const { pattern, replacement } of REDACTION_RULES) {
    text = text.replace(pattern, replacement);
  }
  return text;
}
