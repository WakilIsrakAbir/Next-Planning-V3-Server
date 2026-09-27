import { User } from '../models/User.model.js';

export async function ensureDefaultAdmin(): Promise<void> {
  try {
    const adminCount = await User.countDocuments({ role: 'Admin' });
    if (adminCount === 0) {
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
    }
  } catch (err: any) {
    console.error('Error seeding default admin:', err.message);
  }
}
