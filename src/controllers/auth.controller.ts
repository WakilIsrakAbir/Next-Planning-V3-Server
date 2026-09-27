import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';

export class AuthController {
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body;
      const result = await AuthService.login(username, password);
      res.status(200).json({
        message: 'Login successful!',
        ...result,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || 'Login failed.' });
    }
  }

  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { username, password, role, status, permissions } = req.body;
      const newUser = await AuthService.register({ username, password, role, status, permissions });
      res.status(201).json({
        message: 'Account created successfully!',
        user: {
          id: newUser._id,
          username: newUser.username,
          role: newUser.role,
          status: newUser.status,
          permissions: newUser.permissions,
        },
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || 'Registration failed.' });
    }
  }

  static async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const users = await AuthService.getAllUsers();
      res.status(200).json(users);
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Failed to fetch users.' });
    }
  }

  static async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const userId = String(req.params.id);
      const updated = await AuthService.updateUser(userId, req.body);
      res.status(200).json({
        message: 'User updated successfully!',
        user: {
          id: updated._id,
          username: updated.username,
          role: updated.role,
          status: updated.status,
          permissions: updated.permissions,
        },
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || 'Failed to update user.' });
    }
  }

  static async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const targetUserId = String(req.params.id);
      const currentUserId = req.user!.userId;
      await AuthService.deleteUser(targetUserId, currentUserId);
      res.status(200).json({ message: 'User deleted successfully!' });
    } catch (err: any) {
      res.status(400).json({ message: err.message || 'Failed to delete user.' });
    }
  }

  static async heartbeat(req: Request, res: Response): Promise<void> {
    try {
      if (req.user?.userId) {
        await AuthService.recordHeartbeat(req.user.userId);
      }
      res.status(200).json({ message: 'Heartbeat acknowledged' });
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to record heartbeat' });
    }
  }
}
