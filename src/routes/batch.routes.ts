import express, { Router } from 'express';
import { BatchController } from '../controllers/batch.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireBatchAccess } from '../middleware/batch-access.middleware.js';

const router = Router();

// Every Batch route needs a signed-in user; the token is checked before a large body is read.
router.use(authenticateToken);
// Plan snapshots can be large.
const parseLargeJson = express.json({ limit: '25mb' });

router.get('/units', BatchController.getUnits);
router.get('/state', requireBatchAccess, BatchController.getState);
router.post('/commit', requireBatchAccess, parseLargeJson, BatchController.commit);

export default router;
