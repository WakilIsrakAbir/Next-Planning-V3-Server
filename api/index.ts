import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { AuthService } from '../src/services/auth.service.js';

// One connection per function instance, shared by requests that arrive while it is being opened.
// A failed attempt is logged and retried by the next request.
let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await connectDB();
      await AuthService.ensureDefaultAdmin();
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export default async function handler(req: any, res: any) {
  try {
    await ensureReady();
  } catch (e: any) {
    console.error('MongoDB Atlas serverless connection error:', e.message);
  }
  return app(req, res);
}
