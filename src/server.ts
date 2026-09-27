import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { ensureDefaultAdmin } from './scripts/seed-admin.js';

async function startServer(): Promise<void> {
  try {
    // 1. Connect to Database
    await connectDB();

    // 2. Seed initial Super Admin if not present
    await ensureDefaultAdmin();

    // 3. Listen on Port
    const server = app.listen(env.PORT, () => {
      console.log(`🚀 Epylion Next Planning V3 Server running on http://localhost:${env.PORT}`);
    });

    // Graceful Shutdown
    const shutdown = async () => {
      console.log('🛑 Gracefully shutting down server...');
      server.close(() => {
        console.log('💤 HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err: any) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

startServer();
