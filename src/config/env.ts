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
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().optional().default('Banjara Images'),
  PAYMENT_SECRET: z.string().default('mock_payment_secret'),
  EXPO_NOTIFICATION_KEY: z.string().optional().default(''),
  PLATFORM_FEE_RATE: z.coerce.number().default(0.05),
  TAX_RATE: z.coerce.number().default(0.1),
  SERVICE_FEE: z.coerce.number().default(200),
  GEOCODER_USER_AGENT: z.string().optional().default('BanjaraApp/1.0 (support@banjara.app)'),
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
  if (PUBLISHED_PLACEHOLDERS.has(vars.JWT_ACCESS_SECRET)) {
    failures.push('JWT_ACCESS_SECRET is a published placeholder value');
  }
  if (PUBLISHED_PLACEHOLDERS.has(vars.JWT_REFRESH_SECRET)) {
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
      SUPABASE_URL: process.env.SUPABASE_URL ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? 'Banjara Images',
      PAYMENT_SECRET: 'mock_payment_secret',
      EXPO_NOTIFICATION_KEY: '',
      PLATFORM_FEE_RATE: 0.05,
      TAX_RATE: 0.1,
      SERVICE_FEE: 200,
      GEOCODER_USER_AGENT: 'BanjaraApp/1.0 (support@banjara.app)',
    } as z.infer<typeof envSchema>);
