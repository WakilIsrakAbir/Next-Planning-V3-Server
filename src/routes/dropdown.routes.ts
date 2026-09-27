import { Router } from 'express';
import { DropdownController } from '../controllers/dropdown.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireSetupPermission } from '../middleware/role.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', DropdownController.getAll);
router.post('/', requireSetupPermission, DropdownController.addItem);
router.put('/:id', requireSetupPermission, DropdownController.updateItem);
router.delete('/:id', requireSetupPermission, DropdownController.deleteItem);

export default router;
