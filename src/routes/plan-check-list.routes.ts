import { Router } from 'express';
import { PlanCheckListController } from '../controllers/plan-check-list.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requirePlanCheckListPermission } from '../middleware/role.middleware.js';

// Plan Check List (Data Management > Plan Check List): the criteria of the order page's Checkpoint & Planning Guide.
const router = Router();

router.use(authenticateToken);

// Every signed-in user may read it; never 403 (see the controller).
router.get('/', PlanCheckListController.get);
router.put('/', requirePlanCheckListPermission, PlanCheckListController.save);

export default router;
