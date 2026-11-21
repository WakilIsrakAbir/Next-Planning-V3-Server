// Runs before every test file.
// The server's .env holds the LIVE database URI. dotenv never overrides a variable that is already set, so these
// values keep the live URI and the real JWT secret out of the tests even if src/config/env.ts gets loaded.
// Test files that load the Express app also mock src/config/env.js (tests/helpers/http.ts), so .env is not read.
process.env.MONGO_URI = 'mongodb://127.0.0.1:27099/v3t_unused';
process.env.JWT_SECRET = 'v3t-test-secret-only-for-local-tests';
process.env.NODE_ENV = 'test';
