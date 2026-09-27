import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.model.js';

interface IJwtPayload {
  userId: string;
  username: string;
  role: 'Admin' | 'Approver' | 'Planner' | 'Viewer';
  iat?: number;
  exp?: number;
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  // Support token in query parameter for direct browser file downloads
  if (!token && req.query && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ message: 'Authentication required. No token provided.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as IJwtPayload;

    // Fetch user from DB to verify active status and load real-time permissions
    const userDoc = await User.findById(decoded.userId).lean();
    if (!userDoc) {
      res.status(401).json({ message: 'User account no longer exists.' });
      return;
    }

    if (userDoc.status === 'inactive') {
      res.status(403).json({ message: 'Account is inactive. Please contact your system administrator.' });
      return;
    }

    req.user = {
      userId: String(userDoc._id),
      username: userDoc.username,
      role: userDoc.role,
      permissions: userDoc.permissions,
    };

    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ message: 'Session expired (Dhaka midnight rollover). Please log in again.' });
      return;
    }
    res.status(401).json({ message: 'Invalid or corrupted token.' });
  }
}
