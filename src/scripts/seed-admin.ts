import { User } from '../models/User.model.js';
import { connectDB } from '../config/db.js';
import mongoose from 'mongoose';

export async function ensureDefaultAdmin(): Promise<void> {
  try {
    const existingAdmin = await User.findOne({ username: 'admin' });
    if (!existingAdmin) {
      const defaultAdmin = new User({
        username: 'admin',
        password: 'admin123',
        role: 'Admin',
        status: 'active',
        permissions: {
          buyers: { accessType: 'all' },
        },
      });
      await defaultAdmin.save();
      console.log('✅ Default Super Admin initialized: username "admin", password "admin123"');
    } else {
      console.log('ℹ️ Admin user "admin" already exists.');
    }
  } catch (err: any) {
    console.error('Error seeding default admin:', err.message);
  }
}

// Standalone execution support
if (process.argv[1]?.includes('seed-admin')) {
  (async () => {
    try {
      await connectDB();
      await ensureDefaultAdmin();
      await mongoose.disconnect();
      process.exit(0);
    } catch (e: any) {
      console.error('Seed script error:', e.message);
      process.exit(1);
    }
  })();
}

