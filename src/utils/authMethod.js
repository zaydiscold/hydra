const OTP_AUTH_METHODS = new Set(['otp', 'email', 'email_otp']);

export function isOtpAuthMethod(authMethod) {
  return OTP_AUTH_METHODS.has(String(authMethod || '').trim().toLowerCase());
}
