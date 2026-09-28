import * as XLSX from 'xlsx';
import { Order } from '../models/Order.model.js';
import { OrderDate } from '../models/OrderDate.model.js';
import { DeptValidOrders } from '../models/DeptValidOrders.model.js';
import { OrderService } from './order.service.js';

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
    filters?: { buyer?: string; search?: string; status?: string }
  ): Promise<Buffer> {
    const dbDept = dept === 'deliveryfloor' ? 'delivery' : dept;
    const statusField = `${dbDept}PlanStatus`;
    const actualKey = (dept === 'deliveryfloor' ? 'delivery' : dept) + 'Actual';
    const status = filters?.status || 'Pending';

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
    const todayVal = new Date().setHours(0, 0, 0, 0);

    const calcResult = (actualDate?: string, planDate?: string) => {
      const hasActual = actualDate && actualDate.trim() !== '' && actualDate !== '-';
      const hasPlan = planDate && planDate.trim() !== '' && planDate !== '-';
      if (hasActual) {
        if (!hasPlan) return '—';
        return new Date(actualDate).setHours(0, 0, 0, 0) <= new Date(planDate).setHours(0, 0, 0, 0) ? 'Pass' : 'Fail';
      }
      if (hasPlan) {
        if (new Date(planDate).setHours(0, 0, 0, 0) < todayVal) {
          return 'Fail';
        }
      }
      return '—';
    };

    let sl = 1;
    confirmedOrders.forEach((ord) => {
      const plan = planMap.get(ord.orderNo);
      const actual = plan ? plan[actualKey] || {} : {};
      const deptPlanItems = plan ? plan[dbDept] || [] : [];

      let planStart = '';
      let planEnd = '';
      if (Array.isArray(deptPlanItems) && deptPlanItems.length > 0) {
        if (dept === 'deliveryfloor') {
          const floorItems = deptPlanItems.filter(
            (i: any) => i.floorPlanType === 'Confirm' || i.floorPlanType === 'Tentative'
          );
          const starts = floorItems.map((i: any) => i.floorStartDate).filter(Boolean).sort();
          const ends = floorItems.map((i: any) => i.floorEndDate).filter(Boolean).sort();
          if (starts.length) planStart = starts[0];
          if (ends.length) planEnd = ends[ends.length - 1];
        } else {
          const starts = deptPlanItems.map((i: any) => i.startDate).filter(Boolean).sort();
          const ends = deptPlanItems.map((i: any) => i.endDate).filter(Boolean).sort();
          if (starts.length) planStart = starts[0];
          if (ends.length) planEnd = ends[ends.length - 1];
        }
      }

      const actualStart = actual.actualStart || '';
      const actualEnd = actual.actualEnd || '';
      const failReason = actual.failReason || actual.remarks || '';
      const relatedDept = actual.relatedDept || '';

      const hasActualEnd = actualEnd && actualEnd.trim() !== '' && actualEnd !== '-';
      if (status === 'Pending' && hasActualEnd) return;
      if (status === 'Complete' && !hasActualEnd) return;

      const startResult = calcResult(actualStart, planStart);
      const endResult = calcResult(actualEnd, planEnd);

      const dynCols: Record<string, any> = {};
      const { extProd, extBal } = OrderService.computeTrackingDeptValues(
        {
          uploadedItems: (ord as any)[`${dbDept}Items`] || [],
          [dbDept]: deptPlanItems,
        },
        dept
      );
      if (dept === 'knitting') {
        dynCols['Knit Prod.'] = extProd !== '' ? Number(extProd).toFixed(2) : '';
        dynCols['Knit Bal.'] = extBal !== '' ? Number(extBal).toFixed(2) : '';
      } else if (dept === 'dyeing') {
        dynCols['Dyeing Prod.'] = extProd !== '' ? Number(extProd).toFixed(2) : '';
        dynCols['Dyeing Bal.'] = extBal !== '' ? Number(extBal).toFixed(2) : '';
      } else if (dept === 'delivery' || dept === 'deliveryfloor') {
        dynCols['NetDeliveryQtyKgs'] = extProd !== '' ? Number(extProd).toFixed(2) : '';
        dynCols['Deli. Bal.'] = extBal !== '' ? Number(extBal).toFixed(2) : '';
      }

      exportRows.push({
        'SL': sl++,
        'Order/Booking No.': ord.orderNo,
        'Buyer': ord.buyer,
        ...dynCols,
        'Plan Start': planStart,
        'Plan End': planEnd,
        'Actual Start': actualStart,
        'Actual End': actualEnd,
        'Start Result': startResult,
        'End Result': endResult,
        'Fail Reason': failReason,
        'Related Dept.': relatedDept,
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows.length > 0 ? exportRows : [{ Message: 'No data available' }]);
    XLSX.utils.book_append_sheet(wb, ws, `${dept.toUpperCase()} Tracking`);

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
