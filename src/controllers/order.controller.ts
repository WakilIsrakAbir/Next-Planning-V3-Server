import { Request, Response } from 'express';
import { OrderService } from '../services/order.service.js';
import { ReportExportService } from '../services/report-export.service.js';
import { PlanStatus } from '../models/Order.model.js';

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
      const result = await OrderService.getOrderDetails(orderNo, dept);
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

  static async getTracking(req: Request, res: Response): Promise<void> {
    try {
      const dept = String(req.params.dept);
      const {
        page = 1,
        limit = 10,
        buyer = '',
        search = '',
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
      const result = await OrderService.getReportData(dept, req.allowedRawBuyers);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to fetch report data.' });
    }
  }

  static async downloadReportExcel(req: Request, res: Response): Promise<void> {
    try {
      const dept = String(req.params.dept);
      const buffer = await ReportExportService.generateDepartmentReport(dept, req.allowedRawBuyers);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${dept}-report-${Date.now()}.xlsx"`);
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to export report Excel.' });
    }
  }

  static async downloadTrackingExcel(req: Request, res: Response): Promise<void> {
    try {
      const dept = String(req.params.dept);
      const buffer = await ReportExportService.generateTrackingReport(dept, req.allowedRawBuyers, {
        buyer: req.query.buyer ? String(req.query.buyer) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${dept}-tracking-${Date.now()}.xlsx"`);
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
