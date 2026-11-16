import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import { UploadController } from '../controllers/upload.controller.js';
import { OrderController } from '../controllers/order.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireAdmin } from '../middleware/role.middleware.js';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

const router = Router();

router.use(authenticateToken);

// File management
router.post('/upload', upload.single('document'), UploadController.uploadFile);
router.get('/all', UploadController.getAllFiles);
router.get('/download/:filename', UploadController.downloadFile);
// The "clear-all-planning" total wipe was removed on 16 Nov 2026: it deleted every saved plan in the
// database V3 shares with the old app, with no way back. A full restore is done from a backup instead.
router.delete('/:id', UploadController.deleteFile);

// Planning date and migration endpoints
router.post('/save-dates', OrderController.saveDates);
router.get('/all-dates', OrderController.getAllDates);
router.post('/specific-dates', OrderController.getSpecificDates);
router.get('/dept-dates/:dept', OrderController.getDeptDates);
router.post('/migrate-to-orders', requireAdmin, UploadController.migrateToOrders);

export default router;
