import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireAdmin } from '../middleware/role.middleware.js';

const router = Router();

// Public auth routes
router.post('/login', AuthController.login);

// Authenticated user heartbeat
router.post('/heartbeat', authenticateToken, AuthController.heartbeat);

// Admin-only user management routes
router.post('/register', authenticateToken, requireAdmin, AuthController.register);
router.get('/users', authenticateToken, requireAdmin, AuthController.getUsers);
router.put('/user/:id', authenticateToken, requireAdmin, AuthController.updateUser);
router.delete('/user/:id', authenticateToken, requireAdmin, AuthController.deleteUser);

export default router;
