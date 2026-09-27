import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireAdmin } from '../middleware/role.middleware.js';
import { authLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

// Public auth routes with brute-force rate limit protection
router.post('/login', authLimiter, AuthController.login);

// Authenticated user heartbeat
router.post('/heartbeat', authenticateToken, AuthController.heartbeat);

// Admin-only user management routes
router.post('/register', authenticateToken, requireAdmin, authLimiter, AuthController.register);
router.get('/users', authenticateToken, requireAdmin, AuthController.getUsers);
router.put('/user/:id', authenticateToken, requireAdmin, AuthController.updateUser);
router.delete('/user/:id', authenticateToken, requireAdmin, AuthController.deleteUser);

export default router;
