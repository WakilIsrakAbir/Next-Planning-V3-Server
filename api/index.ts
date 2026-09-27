import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { ensureDefaultAdmin } from '../src/scripts/seed-admin.js';

let isConnected = false;

export default async function handler(req: any, res: any) {
  if (!isConnected) {
    try {
      await connectDB();
      await ensureDefaultAdmin();
      isConnected = true;
    } catch (e: any) {
      console.error('MongoDB Atlas serverless connection error:', e.message);
    }
  }
  return app(req, res);
}
