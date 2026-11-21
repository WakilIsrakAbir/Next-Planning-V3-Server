import { defineConfig } from 'vitest/config';

// Server tests (npm test). They live in tests/, outside src, so `npm run build` and `npm run lint` (tsc over src)
// never see them. Every test file uses its own v3t_* database on the LOCAL test MongoDB (127.0.0.1:27099) and
// refuses any other server; see tests/helpers/local-mongo.ts.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
