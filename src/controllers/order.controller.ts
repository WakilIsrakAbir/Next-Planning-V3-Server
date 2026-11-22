import { Request, Response } from 'express';
import { OrderService } from '../services/order.service.js';
import { PlanSaveService } from '../services/plan-save.service.js';
import { PlanGuideService } from '../services/plan-guide.service.js';
import { ReportExportService } from '../services/report-export.service.js';
import { PlanStatus } from '../models/Order.model.js';
import { HttpError } from '../utils/http-error.js';

// Departments with an Updated / Pending report download
const REPORT_DEPTS = ['yd', 'knitting', 'dyeing', 'finishing', 'delivery'];

export class OrderController {
  static async getBuyers(req: Request, res: Response): Promise<void> {
    try {
      const buyers = await OrderService.getUniqueBuyers(req.allowedRawBuyers);
      res.status(200).json(buyers);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch buyers.' });
    }
  }

  static async getDeptBuyers(req: Request, res: Response): Promise<void> {
    try {
      const dept = String(req.params.dept);
      const buyers = await OrderService.getDepartmentBuyers(dept, req.allowedRawBuyers);
      res.status(200).json(buyers);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch department buyers.' });
    }
  }

  static async getDashboardSummary(req: Request, res: Response): Promise<void> {
    try {
      const summary = await OrderService.getDashboardSummary(req.allowedRawBuyers);
      res.status(200).json(summary);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch the dashboard summary.' });
    }
  }

  static async getAllList(req: Request, res: Response): Promise<void> {
    try {
      const { page = 1, limit = 10, search = '' } = req.query;
      const result = await OrderService.getAllOrdersList(
        parseInt(String(page), 10),
        parseInt(String(limit), 10),
        String(search),
        req.allowedRawBuyers
      );
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch order list.' });
    }
  }

  static async getDepartmentOrders(req: Request, res: Response): Promise<void> {
    try {
      const {
        dept = 'knitting',
        status = 'Pending',
        buyer = '',
        page = 1,
        limit = 10,
        search = '',
        exact = 'false',
        populateItems = 'false',
        scope = '',
      } = req.query;

      const result = await OrderService.getDepartmentOrders({
        dept: String(dept),
        status: status as PlanStatus,
        buyer: String(buyer),
        page: parseInt(String(page), 10),
        limit: parseInt(String(limit), 10),
        search: String(search),
        exact: exact === 'true',
        populateItems: populateItems === 'true',
        // scope=all: the search covers every status list, and each order carries its status
        allStatuses: scope === 'all',
        allowedRawBuyers: req.allowedRawBuyers,
      });

      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch department orders.' });
    }
  }

  static async getSingleOrder(req: Request, res: Response): Promise<void> {
    try {
      const orderNo = String(req.params.orderNo);
      const dept = req.query.dept ? String(req.query.dept) : undefined;
      // ?fresh=1 (the order page sends it for a while after a save) skips the 60 s details cache of this instance.
      const fresh = req.query.fresh === '1';
      const result = await OrderService.getOrderDetails(orderNo, dept, { fresh });
      res.status(200).json(result);
    } catch (err: any) {
      res.status(404).json({ message: err.message || 'Order not found.' });
    }
  }

  static async saveDates(req: Request, res: Response): Promise<void> {
    try {
      const { orderNo, department, fabricItems, orderStatus, completedDate, actualData } = req.body;
      const record = await OrderService.savePlanningDates({
        orderNo,
        department,
        fabricItems,
        orderStatus,
        completedDate,
        actualData,
      });
      res.status(200).json({
        message: 'Planning Data saved successfully!',
        data: record,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error while saving planning data.' });
    }
  }

  /** POST /api/orders/save-plans: several departments of one order in one save (PlanSaveService). */
  static async savePlans(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await PlanSaveService.savePlans(req.body));
    } catch (err: any) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      console.error('Save plans error:', err);
      res.status(500).json({ message: 'Server error while saving planning data.' });
    }
  }

  /**
   * PUT /api/orders/:orderNo/plan-guide `{yesIds, dates, version?}`: saves the order's Checkpoint & Planning Guide
   * (any signed-in user) and answers the saved guide.
   */
  static async savePlanGuide(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await PlanGuideService.save(req.user, String(req.params.orderNo), req.body));
    } catch (err: any) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      console.error('Save plan guide error:', err);
      res.status(500).json({ message: 'Server error while saving the Planning Guide.' });
    }
  }

  static async getTracking(req: Request, res: Response): Promise<void> {
    try {
      const dept = String(req.params.dept);
      const {
        page = 1,
        limit = 10,
        buyer = '',
        search = '',
        all = '',
        status = '',
        exact = '',
        startMin = '',
        startMax = '',
        endMin = '',
        endMax = '',
      } = req.query;

      const result = await OrderService.getTrackingData({
        dept,
        page: parseInt(String(page), 10),
        limit: parseInt(String(limit), 10),
        buyer: String(buyer),
        search: String(search),
        all: String(all),
        status: String(status),
        exact: String(exact),
        startMin: String(startMin),
        startMax: String(startMax),
        endMin: String(endMin),
        endMax: String(endMax),
        allowedRawBuyers: req.allowedRawBuyers,
      });

      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch tracking data.' });
    }
  }

  static async getReport(req: Request, res: Response): Promise<void> {
    try {
      const dept = String(req.params.dept);
      const includePending = String(req.query.includePending || '') === 'true';
      const pendingOnly = String(req.query.pendingOnly || '') === 'true';
      const result = await OrderService.getReportData(dept, req.allowedRawBuyers, includePending, pendingOnly);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch report data.' });
    }
  }

  // Updated report: Confirm + Tentative (YD and Delivery also Pending)
  static async downloadReportExcel(req: Request, res: Response): Promise<void> {
    await OrderController.sendDepartmentReport(req, res, false);
  }

  // Pending report: only the department's Pending orders, same columns as the Updated report
  static async downloadPendingReportExcel(req: Request, res: Response): Promise<void> {
    await OrderController.sendDepartmentReport(req, res, true);
  }

  private static async sendDepartmentReport(req: Request, res: Response, pendingOnly: boolean): Promise<void> {
    try {
      const dept = String(req.params.dept);
      if (!REPORT_DEPTS.includes(dept)) {
        res.status(400).json({ message: 'Unknown department' });
        return;
      }
      const buffer = await ReportExportService.generateDepartmentReport(dept, req.allowedRawBuyers, { pendingOnly });
      if (!buffer) {
        res.status(404).json({ message: 'No data to export' });
        return;
      }
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `${dept.toUpperCase()}_${pendingOnly ? 'Pending_' : ''}Report_${dateStr}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to export report Excel.' });
    }
  }

  static async downloadTrackingExcel(req: Request, res: Response): Promise<void> {
    try {
      const dept = String(req.params.dept);
      const status = req.query.status ? String(req.query.status) : 'Pending';
      const buffer = await ReportExportService.generateTrackingReport(dept, req.allowedRawBuyers, {
        buyer: req.query.buyer ? String(req.query.buyer) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        status,
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${dept}-${status}-tracking-${Date.now()}.xlsx"`);
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to export tracking Excel.' });
    }
  }

  static async downloadLoadExcel(req: Request, res: Response): Promise<void> {
    try {
      const type = (req.params.type as 'detailed' | 'summary') || 'detailed';
      const buffer = await ReportExportService.generateLoadCalculationExcel(type, req.allowedRawBuyers);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="load-calculation-${type}-${Date.now()}.xlsx"`);
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to export load calculation Excel.' });
    }
  }

  static async getAllDates(req: Request, res: Response): Promise<void> {
    try {
      const dates = await OrderService.getAllDates();
      res.status(200).json(dates);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch all dates.' });
    }
  }

  static async getSpecificDates(req: Request, res: Response): Promise<void> {
    try {
      const { orderNos, dept } = req.body;
      const dates = await OrderService.getSpecificDates(orderNos, dept);
      res.status(200).json(dates);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch specific dates.' });
    }
  }

  static async getDeptDates(req: Request, res: Response): Promise<void> {
    try {
      const dept = String(req.params.dept);
      const dates = await OrderService.getDeptDates(dept);
      res.status(200).json(dates);
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Failed to fetch department dates.' });
    }
  }
}
