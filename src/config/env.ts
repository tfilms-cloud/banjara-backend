import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CLIENT_URL: z.string().default('http://localhost:8081'),
  /** Comma-separated extra CORS origins for Expo web/dev clients */
  CLIENT_ORIGINS: z.string().optional().default(''),
  /**
   * Website refresh-token cookie. `lax` works when the website and API share a site
   * (localhost:3000 + localhost:5000, or banjara.app + api.banjara.app). Use `none`
   * (requires COOKIE_SECURE=true) only if they live on unrelated domains.
   */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? process.env.NODE_ENV === 'production' : v === 'true' || v === '1')),
  COOKIE_DOMAIN: z.string().optional().default(''),
  /** Encrypts admins' 2-step verification secrets at rest. Falls back to a key derived from JWT_REFRESH_SECRET. */
  MFA_ENCRYPTION_KEY: z.string().optional().default(''),
  /**
   * Admins must turn on 2-step verification before using the admin API.
   * Defaults to on in production, off elsewhere.
   */
  ADMIN_REQUIRE_2FA: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? process.env.NODE_ENV === 'production' : v === 'true' || v === '1')),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().optional().default('Banjara Images'),
  SUPABASE_PAYMENT_BUCKET: z.string().default('banjara-payments-private'),
  PAYMENT_SECRET: z.string().default('mock_payment_secret'),
  EXPO_NOTIFICATION_KEY: z.string().optional().default(''),
  PLATFORM_FEE_RATE: z.coerce.number().default(0.002),
  TAX_RATE: z.coerce.number().default(0.1),
  SERVICE_FEE: z.coerce.number().default(200),
  GEOCODER_USER_AGENT: z.string().optional().default('BanjaraApp/1.0 (support@banjara.app)'),
  /** auto | tesseract | http — OCR secrets never belong in the Expo app */
  OCR_PROVIDER: z.enum(['auto', 'tesseract', 'http', 'mock']).optional().default('auto'),
  OCR_API_KEY: z.string().optional().default(''),
  OCR_API_URL: z.string().optional().default('https://api.ocr.space/parse/image'),
  /** Background jobs (payment expiry + booking reminders). Skip in test. */
  JOBS_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  JOBS_INTERVAL_MS: z.coerce.number().default(60_000),
  /** Minutes a booking stays pending before the provider gets a reminder. */
  PENDING_BOOKING_REMINDER_MINUTES: z.coerce.number().default(10),
});

export type Env = z.infer<typeof envSchema>;

/** Placeholders that appear in the public repo / `.env.example`. Never valid in production. */
const PUBLISHED_PLACEHOLDERS = new Set([
  'dev_access_secret_change_me_32',
  'dev_refresh_secret_change_me_32',
  'change_me_access_secret_min_32_chars',
  'change_me_refresh_secret_min_32_chars',
]);

type ProductionCheckVars = Pick<
  Env,
  | 'NODE_ENV'
  | 'JWT_ACCESS_SECRET'
  | 'JWT_REFRESH_SECRET'
  | 'PAYMENT_SECRET'
  | 'MONGODB_URI'
  | 'CLIENT_URL'
>;

function isLocalhostUrl(value: string): boolean {
  return /(^|\/\/)(localhost|127\.0\.0\.1)([:/]|$)/i.test(value);
}

/** Values shipped in `.env.example` are never valid production secrets. */
function isPlaceholderSecret(value: string): boolean {
  return PUBLISHED_PLACEHOLDERS.has(value) || value.startsWith('REPLACE_ME');
}

/**
 * Pure production-safety checks. Returns human-readable failure reasons (never the value
 * itself). Empty when not in production, so dev/test/seed paths are unaffected.
 */
export function validateProductionEnv(vars: ProductionCheckVars): string[] {
  const failures: string[] = [];
  if (vars.NODE_ENV !== 'production') return failures;

  if (vars.JWT_ACCESS_SECRET.length < 32) {
    failures.push('JWT_ACCESS_SECRET must be at least 32 characters');
  }
  if (vars.JWT_REFRESH_SECRET.length < 32) {
    failures.push('JWT_REFRESH_SECRET must be at least 32 characters');
  }
  if (isPlaceholderSecret(vars.JWT_ACCESS_SECRET)) {
    failures.push('JWT_ACCESS_SECRET is a published placeholder value');
  }
  if (isPlaceholderSecret(vars.JWT_REFRESH_SECRET)) {
    failures.push('JWT_REFRESH_SECRET is a published placeholder value');
  }
  if (vars.JWT_ACCESS_SECRET === vars.JWT_REFRESH_SECRET) {
    failures.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
  if (vars.PAYMENT_SECRET === 'mock_payment_secret') {
    failures.push('PAYMENT_SECRET is the published mock placeholder');
  }
  if (isLocalhostUrl(vars.MONGODB_URI)) {
    failures.push('MONGODB_URI must not point at localhost in production');
  }
  if (isLocalhostUrl(vars.CLIENT_URL)) {
    failures.push('CLIENT_URL must not point at localhost in production');
  }
  return failures;
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  // Read process.env.NODE_ENV directly: env.NODE_ENV is exactly the value we cannot
  // trust at this point.
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

if (parsed.success && parsed.data.NODE_ENV === 'production') {
  const failures = validateProductionEnv(parsed.data);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`Environment validation failed: ${failure}`);
    }
    process.exit(1);
  }
}

export const env = parsed.success
  ? parsed.data
  : ({
      PORT: 5000,
      NODE_ENV: 'development',
      MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/banjara',
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me_32',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret_change_me_32',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      CLIENT_URL: 'http://localhost:8081',
      CLIENT_ORIGINS: '',
      COOKIE_SAMESITE: 'lax',
      COOKIE_SECURE: false,
      COOKIE_DOMAIN: '',
      MFA_ENCRYPTION_KEY: '',
      ADMIN_REQUIRE_2FA: false,
      SUPABASE_URL: process.env.SUPABASE_URL ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? 'Banjara Images',
      SUPABASE_PAYMENT_BUCKET: process.env.SUPABASE_PAYMENT_BUCKET ?? 'banjara-payments-private',
      PAYMENT_SECRET: 'mock_payment_secret',
      EXPO_NOTIFICATION_KEY: '',
      PLATFORM_FEE_RATE: 0.002,
      TAX_RATE: 0.1,
      SERVICE_FEE: 200,
      GEOCODER_USER_AGENT: 'BanjaraApp/1.0 (support@banjara.app)',
      OCR_PROVIDER: 'auto',
      OCR_API_KEY: process.env.OCR_API_KEY ?? '',
      OCR_API_URL: process.env.OCR_API_URL ?? 'https://api.ocr.space/parse/image',
      JOBS_ENABLED: true,
      JOBS_INTERVAL_MS: 60_000,
      PENDING_BOOKING_REMINDER_MINUTES: 10,
    } as z.infer<typeof envSchema>);
