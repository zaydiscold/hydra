import React, { memo } from 'react';

// Auth method badge — identifies how the account logs in (OTP, PASS, MAGIC LINK, etc.)
// Dims when the session is not active so it's clear the method isn't currently signed in.
const AuthBadge = memo(function AuthBadge({ method, hasManagementKey, hasCredentials, sessionActive = false }) {
  // Key-only import: management key but no email/password credentials on file
  const keyOnly =
    hasManagementKey &&
    !hasCredentials &&
    (method == null || method === '' || method === 'unknown');

  if (keyOnly) {
    return (
      <span
        className="badge badge-method"
        title="Imported with management key only — no email/password or OTP on file"
      >
        [MGMT]
      </span>
    );
  }

  // No method at all
  if (!method || method === 'unknown' || method === '') {
    return <span className="badge badge-neutral" style={{ opacity: 0.4 }}>[?]</span>;
  }

  const METHOD_LABELS = {
    otp:       'OTP',
    email_otp: 'OTP',
    email:     'MAGIC LINK',
    password:  'PASS',
    oauth:     'OAUTH',
    api:       'API',
  };
  const label = METHOD_LABELS[method] || method.toUpperCase();

  return (
    <span
      className="badge badge-method"
      title={`Auth method: ${method}${!sessionActive ? ' (not signed in)' : ''}`}
      style={sessionActive ? undefined : {
        opacity: 0.22,
        filter: 'grayscale(1) brightness(0.7)',
        textShadow: 'none',
      }}
    >
      [{label}]
    </span>
  );
});

export default AuthBadge;
