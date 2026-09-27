import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_URI: z.string().default('mongodb://localhost:27017/next_planning_v3'),
  JWT_SECRET: z.string().min(10, 'JWT_SECRET must be at least 10 characters long'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
