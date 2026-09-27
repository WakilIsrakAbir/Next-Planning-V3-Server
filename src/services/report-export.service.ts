import * as XLSX from 'xlsx';
import { Order } from '../models/Order.model.js';
import { OrderDate } from '../models/OrderDate.model.js';
import { DeptValidOrders } from '../models/DeptValidOrders.model.js';

export class ReportExportService {
  /**
   * Generates formatted Excel binary buffer for Department Reports
   */
  static async generateDepartmentReport(dept: string, allowedRawBuyers?: string[]): Promise<Buffer> {
    const statusField = `${dept}PlanStatus`;
    const itemsField = `${dept}Items`;
    const statusList = dept === 'delivery' ? ['Pending', 'Confirm', 'Tentative'] : ['Confirm', 'Tentative'];

    const filter: Record<string, any> = {
      [statusField]: { $in: statusList },
      [itemsField]: { $exists: true, $ne: [] },
    };

    const deptValid = await DeptValidOrders.findOne({ dept }).lean();
    if (deptValid?.validOrderNos && deptValid.validOrderNos.length > 0) {
      filter.orderNo = { $in: deptValid.validOrderNos };
    }

    if (allowedRawBuyers) {
      filter.buyer = { $in: allowedRawBuyers };
    }

    const orders = await Order.find(filter).lean();
    const orderNos = orders.map((o) => o.orderNo);
    const planDocs = await OrderDate.find({ orderNo: { $in: orderNos } }).lean();

    const planMap = new Map<string, any>();
    planDocs.forEach((p) => planMap.set(p.orderNo, p));

    const exportRows: any[] = [];

    orders.forEach((ord) => {
      const items = (ord as any)[itemsField] || [];
      const plan = planMap.get(ord.orderNo);
      const planItems = plan ? plan[dept] || [] : [];
      const planItemMap = new Map<string, any>();
      planItems.forEach((pi: any) => {
        if (pi.itemId) planItemMap.set(pi.itemId, pi);
      });

      items.forEach((item: any, idx: number) => {
        const pItem = planItemMap.get(item.itemId || String(idx)) || {};
        exportRows.push({
          OrderNo: ord.orderNo,
          Buyer: ord.buyer || '',
          BookingDate: ord.bookingDate || '',
          ...item,
          PlanType: pItem.planType || '',
          PlanStart: pItem.planStart || '',
          PlanEnd: pItem.planEnd || '',
          Unit: pItem.unit || '',
          ProcessName: pItem.processName || '',
          Remarks: pItem.remarks || '',
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows.length > 0 ? exportRows : [{ Message: 'No data available' }]);
    XLSX.utils.book_append_sheet(wb, ws, `${dept.toUpperCase()} Report`);

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Generates formatted Excel binary buffer for Plan vs Actual Tracking
   */
  static async generateTrackingReport(
    dept: string,
    allowedRawBuyers?: string[],
    filters?: { buyer?: string; search?: string }
  ): Promise<Buffer> {
    const dbDept = dept === 'deliveryfloor' ? 'delivery' : dept;
    const statusField = `${dbDept}PlanStatus`;

    const filter: Record<string, any> = { [statusField]: 'Confirm' };

    const deptValid = await DeptValidOrders.findOne({ dept: dbDept }).lean();
    if (deptValid?.validOrderNos && deptValid.validOrderNos.length > 0) {
      filter.orderNo = { $in: deptValid.validOrderNos };
    }

    if (filters?.buyer) filter.buyer = { $regex: filters.buyer, $options: 'i' };
    if (filters?.search) filter.orderNo = { $regex: filters.search, $options: 'i' };
    if (allowedRawBuyers) filter.buyer = { $in: allowedRawBuyers };

    const confirmedOrders = await Order.find(filter).lean();
    const orderNos = confirmedOrders.map((o) => o.orderNo);
    const planDocs = await OrderDate.find({ orderNo: { $in: orderNos } }).lean();

    const planMap = new Map<string, any>();
    planDocs.forEach((p) => planMap.set(p.orderNo, p));

    const exportRows: any[] = [];

    confirmedOrders.forEach((ord) => {
      const plan = planMap.get(ord.orderNo);
      const actualKey = `${dept}Actual`;
      const actual = plan ? plan[actualKey] || {} : {};
      const deptPlanItems = plan ? plan[dbDept] || [] : [];

      let planStart = '';
      let planEnd = '';
      if (Array.isArray(deptPlanItems) && deptPlanItems.length > 0) {
        planStart = deptPlanItems[0].planStart || '';
        planEnd = deptPlanItems[0].planEnd || '';
      }

      let leadDays = '—';
      if (planEnd && actual.actualEnd) {
        const pDate = new Date(planEnd);
        const aDate = new Date(actual.actualEnd);
        if (!isNaN(pDate.getTime()) && !isNaN(aDate.getTime())) {
          const diff = Math.round((aDate.getTime() - pDate.getTime()) / (1000 * 60 * 60 * 24));
          leadDays = diff > 0 ? `+${diff}` : String(diff);
        }
      }

      exportRows.push({
        OrderNo: ord.orderNo,
        Buyer: ord.buyer,
        BookingDate: ord.bookingDate,
        Style: ord.style || '',
        PlanStart: planStart,
        PlanEnd: planEnd,
        ActualStart: actual.actualStart || '',
        ActualEnd: actual.actualEnd || '',
        ActualProd: actual.actualProd || '',
        LeadDays: leadDays,
        Status: actual.status || 'Pending',
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows.length > 0 ? exportRows : [{ Message: 'No data available' }]);
    XLSX.utils.book_append_sheet(wb, ws, `Tracking - ${dept}`);

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Generates formatted Excel binary buffer for 5-month Load Calculation
   */
  static async generateLoadCalculationExcel(
    type: 'detailed' | 'summary',
    allowedRawBuyers?: string[]
  ): Promise<Buffer> {
    const filter: Record<string, any> = {};
    if (allowedRawBuyers) {
      filter.buyer = { $in: allowedRawBuyers };
    }

    const orders = await Order.find(filter).lean();
    const exportRows: any[] = [];

    orders.forEach((ord) => {
      exportRows.push({
        OrderNo: ord.orderNo,
        Buyer: ord.buyer,
        BookingDate: ord.bookingDate,
        KnitStart: ord.knitStart,
        KnitEnd: ord.knitEnd,
        DyeStart: ord.dyeStart,
        DyeEnd: ord.dyeEnd,
        DeliStart: ord.deliStart,
        DeliEnd: ord.deliEnd,
        RequiredQtyKgs: ord.requiredQtyKgs,
        KnittingStatus: ord.knittingPlanStatus,
        DyeingStatus: ord.dyeingPlanStatus,
        DeliveryStatus: ord.deliveryPlanStatus,
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows.length > 0 ? exportRows : [{ Message: 'No load data' }]);
    XLSX.utils.book_append_sheet(wb, ws, type === 'detailed' ? 'Detailed Load' : 'Load Summary');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}
