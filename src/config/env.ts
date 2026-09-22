import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
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

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  if (process.env.NODE_ENV !== 'test') {
    // Allow seed/dev to fail loudly if URI missing
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
