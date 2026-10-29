/* CLI: `npm run seed` creates the default Super Admin when it is missing (the server also does this at startup). */
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { AuthService } from '../services/auth.service.js';

(async () => {
  try {
    await connectDB();
    await AuthService.ensureDefaultAdmin();
    await mongoose.disconnect();
    process.exit(0);
  } catch (e: any) {
    console.error('Seed script error:', e.message);
    process.exit(1);
  }
})();
