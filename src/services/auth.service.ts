import jwt from 'jsonwebtoken';
import { User, IUser, IUserPermissions } from '../models/User.model.js';
import { env } from '../config/env.js';
import { getSecondsUntilDhakaMidnight } from '../utils/dhaka-time.js';

export interface ILoginResult {
  token: string;
  sessionExpiresAt: number;
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
    permissions: IUserPermissions;
  };
}

export class AuthService {
  static async login(username: string, password: string): Promise<ILoginResult> {
    // Only plain strings: an object such as {"$ne": null} must never reach the query (NoSQL operator injection).
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      throw new Error('Username and password are required.');
    }

    // One message for an unknown user and a wrong password, so usernames cannot be probed.
    const INVALID = 'Invalid username or password.';
    const user = await User.findOne({ username: username.trim() }).select('+password');
    if (!user) {
      throw new Error(INVALID);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new Error(INVALID);
    }

    // Told only to someone who knows the password.
    if (user.status === 'inactive') {
      throw new Error('Your account is deactivated. Please contact your administrator.');
    }

    const { seconds: expiresInSeconds, expiresAt: sessionExpiresAt } = getSecondsUntilDhakaMidnight();

    const payload = {
      userId: user._id,
      username: user.username,
      role: user.role,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: expiresInSeconds });

    // Update lastActive timestamp
    await User.findByIdAndUpdate(user._id, { lastActive: new Date() });

    return {
      token,
      sessionExpiresAt,
      user: {
        id: String(user._id),
        username: user.username,
        role: user.role,
        status: user.status,
        permissions: user.permissions || {},
      },
    };
  }

  static async register(data: {
    username: string;
    password: string;
    role?: 'Admin' | 'Approver' | 'Planner' | 'Viewer';
    status?: 'active' | 'inactive';
    permissions?: IUserPermissions;
  }): Promise<IUser> {
    const trimmedUsername = data.username.trim();
    const existing = await User.findOne({ username: trimmedUsername });
    if (existing) {
      throw new Error(`Username "${trimmedUsername}" is already taken.`);
    }

    const newUser = new User({
      username: trimmedUsername,
      password: data.password,
      role: data.role || 'Viewer',
      status: data.status || 'active',
      permissions: data.permissions || {},
      lastActive: new Date(),
    });

    await newUser.save();
    return newUser;
  }

  static async getAllUsers(): Promise<IUser[]> {
    return User.find().sort({ createdAt: -1 });
  }

  static async updateUser(
    id: string,
    data: {
      username?: string;
      password?: string;
      role?: 'Admin' | 'Approver' | 'Planner' | 'Viewer';
      status?: 'active' | 'inactive';
      permissions?: IUserPermissions;
    }
  ): Promise<IUser> {
    const user = await User.findById(id).select('+password');
    if (!user) {
      throw new Error('User not found.');
    }

    if (data.username && data.username.trim()) {
      user.username = data.username.trim();
    }
    if (data.role) user.role = data.role;
    if (data.status) user.status = data.status;
    if (data.permissions) user.permissions = data.permissions;

    if (data.password && data.password.trim()) {
      user.password = data.password.trim(); // Will be hashed by pre-save hook
    }

    await user.save();
    return user;
  }

  static async deleteUser(targetUserId: string, requestingUserId: string): Promise<void> {
    if (String(targetUserId) === String(requestingUserId)) {
      throw new Error('You cannot delete your own active administrator account.');
    }

    const deleted = await User.findByIdAndDelete(targetUserId);
    if (!deleted) {
      throw new Error('User not found.');
    }
  }

  static async recordHeartbeat(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { lastActive: new Date() });
  }

  /**
   * First-run bootstrap only: when the database has NO Admin at all, creates user "admin" with the password from
   * DEFAULT_ADMIN_PASSWORD (at least 10 characters). Without that variable nothing is created. There is no
   * built-in password, so a known default can never open a live system.
   */
  static async ensureDefaultAdmin(): Promise<void> {
    try {
      const anyAdmin = await User.exists({ role: 'Admin' });
      const bootstrapPassword = process.env.DEFAULT_ADMIN_PASSWORD || '';
      if (!anyAdmin && bootstrapPassword.length < 10) {
        console.warn('⚠️ No Admin user exists. Set DEFAULT_ADMIN_PASSWORD (10+ characters) once to create user "admin".');
        return;
      }
      const existingAdmin = anyAdmin ? true : await User.findOne({ username: 'admin' });
      if (!existingAdmin) {
        const defaultAdmin = new User({
          username: 'admin',
          password: bootstrapPassword,
          role: 'Admin',
          status: 'active',
          permissions: {
            buyers: { accessType: 'all' },
          },
        });
        await defaultAdmin.save();
        console.log('✅ Bootstrap Admin "admin" created from DEFAULT_ADMIN_PASSWORD. Change the password after the first login.');
      } else {
        console.log('ℹ️ An Admin user already exists; no bootstrap needed.');
      }
    } catch (err: any) {
      console.error('Error seeding default admin:', err.message);
    }
  }
}
