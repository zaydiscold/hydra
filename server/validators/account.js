import { z } from 'zod';

export const addAccountSchema = z.object({
  alias: z.string().min(2, 'Alias must be at least 2 characters').max(50).transform(v => v.trim()),
  managementKey: z.string().min(1, 'Management key is required').transform(v => v.trim()),
});

export const addAccountWithCredentialsSchema = z.object({
  alias: z.string().min(2).max(50).transform(v => v.trim()),
  email: z.string().email('Invalid email format').transform(v => v.trim()),
  password: z.string().optional(),
  authMethod: z.enum(['password', 'otp']).default('password'),
});

export const bulkAddSchema = z.object({
  lines: z.array(z.string()).min(1, 'At least one line is required'),
});

const MAX_BULK_OTP_STUBS = 150;

export const bulkOtpStubsSchema = z.object({
  emails: z
    .array(z.string().trim().toLowerCase().email('Invalid email'))
    .min(1, 'At least one email is required')
    .max(MAX_BULK_OTP_STUBS, `At most ${MAX_BULK_OTP_STUBS} emails per request`),
});

export const updateAccountSchema = z
  .object({
    alias: z.string().min(2).max(50).transform((v) => v.trim()).optional(),
    managementKey: z.string().min(1).transform((v) => v.trim()).optional(),
    email: z.string().email('Invalid email format').transform((v) => v.trim()).optional(),
    password: z.string().optional(),
    authMethod: z.enum(['password', 'otp']).optional(),
  })
  .superRefine((data, ctx) => {
    const hasPassword = data.password !== undefined && String(data.password).length > 0;
    if (hasPassword && data.email === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email is required when setting a password',
        path: ['email'],
      });
      return;
    }
    if (data.email === undefined) return;
    const method = data.authMethod ?? (hasPassword ? 'password' : 'otp');
    if (method === 'password' && !hasPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password is required for password sign-in',
        path: ['password'],
      });
    }
  })
  .transform((data) => {
    if (data.email === undefined) return data;
    const hasPassword = data.password !== undefined && String(data.password).length > 0;
    const authMethod = data.authMethod ?? (hasPassword ? 'password' : 'otp');
    return { ...data, authMethod };
  });

export const otpVerifySchema = z.object({
  signInId: z.string().min(1, 'signInId is required'),
  code: z.string().length(6, 'OTP must be exactly 6 characters'),
  /** Complete TOTP after password sign-in (Clerk needs_second_factor). */
  totpSecondFactor: z.boolean().optional(),
});
