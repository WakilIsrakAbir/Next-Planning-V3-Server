// Stand-in for src/config/env.ts in tests that load the Express app, so the server's .env (which holds the LIVE
// database URI and the real JWT secret) is never read. Used as: vi.mock('<...>/src/config/env.js', () => import(this)).
export const TEST_JWT_SECRET = 'v3t-test-secret-only-for-local-tests';

export const env = {
  PORT: 0,
  NODE_ENV: 'test' as const,
  MONGO_URI: 'mongodb://127.0.0.1:27099/v3t_unused',
  JWT_SECRET: TEST_JWT_SECRET,
  CLIENT_URL: 'http://localhost:3123',
};
