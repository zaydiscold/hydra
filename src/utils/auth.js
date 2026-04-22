/**
 * Helpers for authentication and account parsing.
 */

export function parseEmails(text) {
  if (!text) return [];
  return [
    ...new Set(
      text
        .split(/[\n,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes('@')),
    ),
  ];
}

export function clerkErrorHint(message) {
  if (!message) return '';
  const m = message.toLowerCase();
  if (m.includes('rate') || m.includes('429')) {
    return 'Too many OTP requests send from this IP — wait 5-10 min.';
  }
  if (m.includes('email_code') || m.includes('strategy') || m.includes('not available')) {
    return 'Clerk may not offer email_code for this address. Try the Email Link tab instead.';
  }
  return '';
}
