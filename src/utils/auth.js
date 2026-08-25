/**
 * Helpers for authentication and account parsing.
 */

export function parseEmails(text) {
  if (!text) return [];
  return parseEmailEntries(text).emails;
}

export function parseEmailEntries(text) {
  const tokens = String(text || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
  const seen = new Set();
  const emails = [];
  const duplicates = [];

  for (const token of tokens) {
    if (seen.has(token)) {
      duplicates.push(token);
      continue;
    }
    seen.add(token);
    emails.push(token);
  }

  return { emails, duplicates, tokens };
}

export function remainingEmailTextAfterUse(text, usedEmails = []) {
  const used = new Set(usedEmails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean));
  const consumed = new Set();
  const remaining = [];

  for (const token of String(text || '').split(/[\n,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'))) {
    if (used.has(token) && !consumed.has(token)) {
      consumed.add(token);
      continue;
    }
    remaining.push(token);
  }

  return remaining.join('\n');
}

export function normalizeOtpCode(value, length = 6) {
  const maxLength = Number.isInteger(length) && length > 0 ? length : 6;
  return String(value ?? '').replace(/\D/g, '').slice(0, maxLength);
}

export function isCompleteOtpCode(value, length = 6) {
  const maxLength = Number.isInteger(length) && length > 0 ? length : 6;
  return normalizeOtpCode(value, maxLength).length === maxLength;
}

/**
 * Generation guard for async account-auth actions. Starting or invalidating an
 * operation makes every older completion stale, so a modal that closes or
 * switches accounts cannot apply a late password/OTP response to the new UI.
 */
export function createAuthOperationGuard() {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
      return generation;
    },
    isCurrent(operationId) {
      return operationId === generation;
    },
  };
}

export function clerkErrorHint(message) {
  if (!message) return '';
  const m = message.toLowerCase();
  if (m.includes('interactive verification') || m.includes('account generator')) {
    return 'Bulk OTP signs in existing accounts. Generator handles a new OpenRouter signup through its isolated interactive flow.';
  }
  if (m.includes('rate') || m.includes('429')) {
    return 'Too many OTP requests sent from this IP — wait 5-10 min.';
  }
  if (m.includes('email_code') || m.includes('strategy') || m.includes('not available')) {
    return 'Clerk may not offer email_code for this address. Check the account sign-in method. Email Link works only when its capability banner says ready.';
  }
  return '';
}
