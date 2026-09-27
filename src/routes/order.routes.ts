import { Router } from 'express';
import { OrderController } from '../controllers/order.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { buyerFilterMiddleware } from '../middleware/buyer-filter.middleware.js';

const router = Router();

// Protect all order endpoints with authentication and buyer access scoping
router.use(authenticateToken);
router.use(buyerFilterMiddleware);

// Buyer List Endpoints
router.get('/buyers', OrderController.getBuyers);
router.get('/buyers/:dept', OrderController.getDeptBuyers);

// All-orders overview (Order Status & PPI lists)
router.get('/all-list', OrderController.getAllList);

// Department Planning Endpoints
router.get('/', OrderController.getDepartmentOrders);
router.post('/save-dates', OrderController.saveDates);

// Plan vs Actual Tracking Endpoints
router.get('/tracking/:dept', OrderController.getTracking);
router.get('/tracking-download/:dept', OrderController.downloadTrackingExcel);

// Department Confirmed/Tentative Reports
router.get('/report/:dept', OrderController.getReport);
router.get('/report-download/:dept', OrderController.downloadReportExcel);

// 5-Month Load Calculation Download
router.get('/load-download/:type', OrderController.downloadLoadExcel);

// Individual Order Details
router.get('/:orderNo', OrderController.getSingleOrder);

export default router;
