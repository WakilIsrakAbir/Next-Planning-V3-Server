import { Router } from 'express';
import { MonitorController } from '../controllers/monitor.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireAdmin, requireAtlasMonitorPermission } from '../middleware/role.middleware.js';

// Atlas Monitor (Data Management > Atlas Monitor): database health and the full backup download.
const router = Router();

router.use(authenticateToken);

router.get('/stats', requireAtlasMonitorPermission, MonitorController.getStats);
router.get('/backup', requireAdmin, MonitorController.downloadBackup);

export default router;
