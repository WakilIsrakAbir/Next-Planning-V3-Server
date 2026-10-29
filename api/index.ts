import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { AuthService } from '../src/services/auth.service.js';

let isConnected = false;

export default async function handler(req: any, res: any) {
  if (!isConnected) {
    try {
      await connectDB();
      await AuthService.ensureDefaultAdmin();
      isConnected = true;
    } catch (e: any) {
      console.error('MongoDB Atlas serverless connection error:', e.message);
    }
  }
  return app(req, res);
}
