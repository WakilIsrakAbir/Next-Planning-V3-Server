import * as XLSX from 'xlsx';
import { Order } from '../models/Order.model.js';
import { OrderDate } from '../models/OrderDate.model.js';
import { DeptValidOrders } from '../models/DeptValidOrders.model.js';
import { OrderService } from './order.service.js';
import { normalizeItemRow, matchKey, hasValue, copyFields, fillMissingFields } from '../utils/order-items.js';

export class ReportExportService {
  /**
   * Generates formatted Excel binary buffer for Department Reports.
   *
   * Rows come from the saved plan (OrderDate.<dept>), normalized with `normalizeItemRow`.
   * Knitting, Dyeing and Delivery rows are refreshed from the latest uploaded department
   * items of the Order (with cross-department fallbacks matched by colour). Delivery also
   * lists Pending orders that have no saved plan yet. Column set and order match the
   * legacy backend's /report-download endpoint.
   *
   * Returns null when there is nothing to export.
   */
  static async generateDepartmentReport(dept: string, allowedRawBuyers?: string[]): Promise<Buffer | null> {
    const statusField = `${dept}PlanStatus`;

    // Delivery / YD: Pending + Confirm + Tentative. Knitting / Dyeing / Finishing: Confirm + Tentative.
    const statusList =
      dept === 'delivery' || dept === 'yd' ? ['Pending', 'Confirm', 'Tentative'] : ['Confirm', 'Tentative'];
    const filter: Record<string, any> = {
      [statusField]: { $in: statusList },
    };

    // Only include orders from the uploaded file
    const deptValid = await DeptValidOrders.findOne({ dept }).lean();
    if (deptValid?.validOrderNos && deptValid.validOrderNos.length > 0) {
      filter.orderNo = { $in: deptValid.validOrderNos };
    }

    if (allowedRawBuyers) {
      filter.buyer = { $in: allowedRawBuyers };
    }

    // 1. Minimal order info
    const orders: any[] = await Order.find(filter, {
      orderNo: 1,
      buyer: 1,
      'T&A Knitting Start': 1,
      'T&A Knitting End': 1,
    }).lean();
    const orderNos: string[] = orders.map((o) => o.orderNo);

    if (orderNos.length === 0) {
      return null;
    }

    const orderBuyerMap: Record<string, string> = {};
    const orderInfoMap: Record<string, { knitStart: string; knitEnd: string }> = {};
    orders.forEach((o) => {
      orderBuyerMap[o.orderNo] = o.buyer;
      orderInfoMap[o.orderNo] = {
        knitStart: o['T&A Knitting Start'] || '',
        knitEnd: o['T&A Knitting End'] || '',
      };
    });

    const planProjection: Record<string, any> = { orderNo: 1, [dept]: 1 };
    if (dept === 'delivery') {
      planProjection.knitting = 1;
      planProjection.dyeing = 1;
    } else if (dept === 'yd') {
      planProjection.knitting = 1;
    }

    const syncLatest = dept === 'knitting' || dept === 'dyeing' || dept === 'delivery';
    const orderItemProjection: Record<string, any> = { orderNo: 1 };
    if (dept === 'knitting') {
      orderItemProjection.knittingItems = 1;
    } else if (dept === 'dyeing') {
      orderItemProjection.dyeingItems = 1;
      orderItemProjection.knittingItems = 1;
      orderItemProjection.deliveryItems = 1;
    } else if (dept === 'delivery') {
      orderItemProjection.deliveryItems = 1;
      orderItemProjection.knittingItems = 1;
      orderItemProjection.dyeingItems = 1;
    }

    const allRows: Record<string, any>[] = [];
    const planDocOrderNos = new Set<string>();
    const chunkSize = 500; // Process 500 orders at a time to limit memory use

    // 2. Saved plan rows, fetched in chunks
    for (let i = 0; i < orderNos.length; i += chunkSize) {
      const chunkOrderNos = orderNos.slice(i, i + chunkSize);

      const [planDocsChunk, orderItemsDocs] = await Promise.all([
        OrderDate.find(
          {
            orderNo: { $in: chunkOrderNos },
            [dept]: { $exists: true, $ne: [] },
          },
          planProjection
        ).lean() as Promise<any[]>,
        syncLatest
          ? (Order.find({ orderNo: { $in: chunkOrderNos } }, orderItemProjection).lean() as Promise<any[]>)
          : Promise.resolve([] as any[]),
      ]);

      const orderItemsMap: Record<string, any[]> = {};
      const orderKnitMap: Record<string, any[]> = {};
      const orderDyeMap: Record<string, any[]> = {};
      const orderDeliMap: Record<string, any[]> = {};
      orderItemsDocs.forEach((d: any) => {
        if (d.knittingItems) orderKnitMap[d.orderNo] = d.knittingItems;
        if (d.dyeingItems) orderDyeMap[d.orderNo] = d.dyeingItems;
        if (d.deliveryItems) orderDeliMap[d.orderNo] = d.deliveryItems;
        if (dept === 'knitting') orderItemsMap[d.orderNo] = d.knittingItems || [];
        else if (dept === 'dyeing') orderItemsMap[d.orderNo] = d.dyeingItems || [];
        else if (dept === 'delivery') orderItemsMap[d.orderNo] = d.deliveryItems || [];
      });

      planDocsChunk.forEach((plan: any) => {
        planDocOrderNos.add(plan.orderNo);
        const items: any[] = Array.isArray(plan[dept]) ? plan[dept] : [];

        const latestNormItems = (orderItemsMap[plan.orderNo] || []).map((li) => normalizeItemRow(li, dept));
        const knitNormItems = (orderKnitMap[plan.orderNo] || []).map((li) => normalizeItemRow(li, 'knitting'));
        const dyeNormItems = (orderDyeMap[plan.orderNo] || []).map((li) => normalizeItemRow(li, 'dyeing'));
        const deliNormItems = (orderDeliMap[plan.orderNo] || []).map((li) => normalizeItemRow(li, 'delivery'));

        items.forEach((item: any) => {
          const row = normalizeItemRow(item.itemData || {}, dept);
          // Unit / ProcessName fall back to the values saved on the plan row itself
          if (!row.Unit && item.Unit) row.Unit = item.Unit;
          const planProcess = item.ProcessName || item['Process Name'] || item.processName;
          if (!row.ProcessName && planProcess) row.ProcessName = planProcess;

          const myColor = matchKey(row.Color);
          const myConst = matchKey(row.FabricConstruction);
          const myGSM = matchKey(row.GSM);
          const myProcess = matchKey(row.ProcessName);
          const byColor = (n: Record<string, any>) => matchKey(n.Color) === myColor;
          const byColorConstGsm = (n: Record<string, any>) =>
            byColor(n) && matchKey(n.FabricConstruction) === myConst && matchKey(n.GSM) === myGSM;

          if (dept === 'knitting') {
            const latestMatch = latestNormItems.find(byColorConstGsm) || latestNormItems.find(byColor);
            if (latestMatch) {
              copyFields(row, latestMatch, [
                'Allowance',
                'YarnReq',
                'AllocatedQty',
                'YarnBala',
                'GreyReq',
                'KnitProd',
                'KnitBala',
                'RequiredQtyKgs',
                'NetReceivedQtyKgs',
                'NetDeliveryQtyKgs',
                'DeliBal',
                'RFD',
                'Slowmoving',
                'FFStock',
              ]);
            }
          } else if (dept === 'dyeing') {
            const latestMatch =
              latestNormItems.find((n) => byColor(n) && !!myProcess && matchKey(n.ProcessName) === myProcess) ||
              latestNormItems.find(byColor);
            if (latestMatch) {
              copyFields(row, latestMatch, [
                'KnitProd',
                'KnitBala',
                'BPQty',
                'DyeingProd',
                'DyeingBala',
                'GreyReq',
                'NetReceivedQtyKgs',
                'NetDeliveryQtyKgs',
                'RFD',
                'Slowmoving',
                'FFStock',
                'RequiredQtyKgs',
              ]);
              if (!row.Unit && latestMatch.Unit) row.Unit = latestMatch.Unit;
              if (!row.ProcessName && latestMatch.ProcessName) row.ProcessName = latestMatch.ProcessName;
            }

            // Allowance / yarn fields from Knitting when missing
            const knitMatch = knitNormItems.find(byColor);
            if (knitMatch) {
              fillMissingFields(row, knitMatch, ['Allowance', 'YarnReq', 'AllocatedQty', 'YarnBala']);
            }

            // DeliBal from Delivery, else calculated
            const deliMatch = deliNormItems.find(byColor);
            if (deliMatch && hasValue(deliMatch.DeliBal)) {
              row.DeliBal = deliMatch.DeliBal;
            } else if (row.DeliBal === undefined || row.DeliBal === '') {
              const req = Number(row.RequiredQtyKgs) || 0;
              const del = Number(row.NetDeliveryQtyKgs) || 0;
              if (req > 0) row.DeliBal = req - del;
            }
          } else if (dept === 'delivery') {
            const latestMatch = latestNormItems.find(byColorConstGsm) || latestNormItems.find(byColor);
            if (latestMatch) {
              copyFields(row, latestMatch, [
                'Allowance',
                'YarnReq',
                'AllocatedQty',
                'YarnBala',
                'GreyReq',
                'KnitProd',
                'KnitBala',
                'NetReceivedQtyKgs',
                'NetDeliveryQtyKgs',
                'DeliBal',
                'RFD',
                'Slowmoving',
                'FFStock',
                'RequiredQtyKgs',
              ]);
            }

            // BP / dyeing production from Dyeing items
            const dyeMatch = dyeNormItems.find(byColor);
            if (dyeMatch) {
              copyFields(row, dyeMatch, ['BPQty', 'DyeingProd', 'DyeingBala']);
            }

            // Allowance / yarn fields from Knitting when missing
            const knitMatch = knitNormItems.find(byColor);
            if (knitMatch) {
              fillMissingFields(row, knitMatch, ['Allowance', 'YarnReq', 'AllocatedQty', 'YarnBala']);
            }

            if (row.DeliBal === undefined || row.DeliBal === '') {
              const req = Number(row.RequiredQtyKgs) || 0;
              const del = Number(row.NetDeliveryQtyKgs) || 0;
              if (req > 0) row.DeliBal = req - del;
            }
          }

          row['OrderNo'] = plan.orderNo;
          if (!row['Buyer']) row['Buyer'] = orderBuyerMap[plan.orderNo] || '';

          if (dept === 'delivery') {
            const { knitStart, knitEnd, knitType, dyeStart, dyeEnd, dyeType } =
              ReportExportService.findKnitDyePlanDates(plan, myColor, myConst, myGSM);

            row['Knit Start Date'] = knitStart;
            row['Knit End Date'] = knitEnd;
            row['Knit Plan Type'] = knitType;
            row['Dyeing Start Date'] = dyeStart;
            row['Dyeing End Date'] = dyeEnd;
            row['Dyeing Plan Type'] = dyeType;
            row['Delivery Plan Start'] = item.startDate || '';
            row['Delivery Plan End'] = item.endDate || '';
            row['Delivery Plan Type'] = item.planType || '';
            row['Delivery Plan Start (Floor)'] = item.floorStartDate || '';
            row['Delivery Plan End (Floor)'] = item.floorEndDate || '';
            row['Delivery Plan Type (Floor)'] = item.floorPlanType || '';
            row['Limitation'] = item.limitation || '';
            row['Remarks'] = item.remarks || '';
          } else {
            row['Plan Start Date'] = item.startDate || '';
            row['Plan End Date'] = item.endDate || '';
            row['Plan Type'] = item.planType || '';
            if (dept === 'yd') {
              row['Yarn Ok Date'] = item.yarnOkDate || '';
              row['Matching Option Date'] = item.matchingOptionDate || '';
              row['Floor Start Date'] = item.floorStartDate || '';
              row['Floor End Date'] = item.floorEndDate || '';
              row['Floor Plan Type'] = item.floorPlanType || '';

              let knitStart = '';
              let knitEnd = '';
              if (plan.knitting && Array.isArray(plan.knitting) && plan.knitting.length > 0) {
                const kItem = plan.knitting[0];
                knitStart = kItem.startDate || '';
                knitEnd = kItem.endDate || '';
              } else if (orderInfoMap[plan.orderNo]) {
                const info = orderInfoMap[plan.orderNo];
                knitStart = info.knitStart !== 'N/A' && info.knitStart !== '-' ? info.knitStart : '';
                knitEnd = info.knitEnd !== 'N/A' && info.knitEnd !== '-' ? info.knitEnd : '';
              }

              row['Knit Start Date'] = knitStart;
              row['Knit End Date'] = knitEnd;
            }
            row['Limitation'] = item.limitation || '';
            row['Remarks'] = item.remarks || '';
          }

          allRows.push(row);
        });
      });
    }

    // 3. Pure Pending items (Delivery only): orders without a saved delivery plan
    if (dept === 'delivery') {
      const pendingOrderNos = orderNos.filter((no) => !planDocOrderNos.has(no));

      for (let i = 0; i < pendingOrderNos.length; i += chunkSize) {
        const chunkNos = pendingOrderNos.slice(i, i + chunkSize);

        const [pendingItemsDocs, pendingPlanDocs] = await Promise.all([
          Order.find(
            { orderNo: { $in: chunkNos } },
            { orderNo: 1, buyer: 1, [`${dept}Items`]: 1, dyeingItems: 1, knittingItems: 1 }
          ).lean() as Promise<any[]>,
          OrderDate.find({ orderNo: { $in: chunkNos } }, { orderNo: 1, knitting: 1, dyeing: 1 }).lean() as Promise<
            any[]
          >,
        ]);

        const pendingPlanMap: Record<string, any> = {};
        pendingPlanDocs.forEach((p) => {
          pendingPlanMap[p.orderNo] = p;
        });

        pendingItemsDocs.forEach((orderDoc) => {
          const plan = pendingPlanMap[orderDoc.orderNo] || {};
          const dyeItems = (orderDoc.dyeingItems || []).map((di: any) => normalizeItemRow(di, 'dyeing'));
          const deptItems = orderDoc[`${dept}Items`];
          if (!Array.isArray(deptItems)) return;

          deptItems.forEach((itemData: any) => {
            const row = normalizeItemRow(itemData, dept);
            row['OrderNo'] = orderDoc.orderNo;
            if (!row['Buyer']) row['Buyer'] = orderDoc.buyer || orderBuyerMap[orderDoc.orderNo] || '';

            const myColor = matchKey(row.Color);
            const myConst = matchKey(row.FabricConstruction);
            const myGSM = matchKey(row.GSM);

            const dyeMatch = dyeItems.find((di: Record<string, any>) => matchKey(di.Color) === myColor);
            if (dyeMatch) {
              copyFields(row, dyeMatch, ['BPQty', 'DyeingProd', 'DyeingBala']);
            }

            const { knitStart, knitEnd, knitType, dyeStart, dyeEnd, dyeType } =
              ReportExportService.findKnitDyePlanDates(plan, myColor, myConst, myGSM);

            row['Knit Start Date'] = knitStart;
            row['Knit End Date'] = knitEnd;
            row['Knit Plan Type'] = knitType;
            row['Dyeing Start Date'] = dyeStart;
            row['Dyeing End Date'] = dyeEnd;
            row['Dyeing Plan Type'] = dyeType;
            row['Delivery Plan Start'] = '';
            row['Delivery Plan End'] = '';
            row['Delivery Plan Type'] = '';
            row['Delivery Plan Start (Floor)'] = '';
            row['Delivery Plan End (Floor)'] = '';
            row['Delivery Plan Type (Floor)'] = '';
            row['Limitation'] = '';
            row['Remarks'] = '';
            allRows.push(row);
          });
        });
      }
    }

    if (allRows.length === 0) {
      return null;
    }

    // 4. Generate Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(allRows);

    // 5. Post-process cells: OrderNo as number, date columns as Excel dates
    if (ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      let orderNoCol = -1;
      const dateCols: number[] = [];

      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
        const hdr = cell ? String(cell.v).toLowerCase() : '';
        if (hdr === 'orderno') orderNoCol = C;
        if (hdr.includes('date') || hdr.includes('start') || hdr.includes('end')) {
          dateCols.push(C);
        }
      }

      for (let R = 1; R <= range.e.r; ++R) {
        if (orderNoCol >= 0) {
          const cell = ws[XLSX.utils.encode_cell({ r: R, c: orderNoCol })];
          if (cell && cell.v) {
            const num = Number(cell.v);
            if (!isNaN(num)) {
              cell.t = 'n';
              cell.v = num;
            }
          }
        }

        for (const C of dateCols) {
          const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          if (!cell || !cell.v || cell.v === '' || cell.v === 'N/A' || cell.v === '-') continue;

          const d = new Date(cell.v);
          if (!isNaN(d.getTime())) {
            cell.t = 'n';
            cell.v = d.getTime() / 86400000 + 25569;
            cell.z = 'dd/mm/yyyy';
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, `${dept}_Report`);

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Finds the saved Knitting plan (matched by colour + construction + GSM) and Dyeing plan
   * (matched by colour) dates for a delivery report row.
   */
  private static findKnitDyePlanDates(
    plan: any,
    myColor: string,
    myConst: string,
    myGSM: string
  ): { knitStart: string; knitEnd: string; knitType: string; dyeStart: string; dyeEnd: string; dyeType: string } {
    let knitStart = '';
    let knitEnd = '';
    let knitType = '';
    let dyeStart = '';
    let dyeEnd = '';
    let dyeType = '';

    if (plan.knitting && Array.isArray(plan.knitting)) {
      const kItem = plan.knitting.find(
        (k: any) =>
          k.itemData &&
          matchKey(k.itemData.Color) === myColor &&
          matchKey(k.itemData.FabricConstruction) === myConst &&
          matchKey(k.itemData.GSM) === myGSM
      );
      if (kItem) {
        knitStart = kItem.startDate || '';
        knitEnd = kItem.endDate || '';
        knitType = kItem.planType || '';
      }
    }

    if (plan.dyeing && Array.isArray(plan.dyeing)) {
      const dItem = plan.dyeing.find((d: any) => d.itemData && matchKey(d.itemData.Color) === myColor);
      if (dItem) {
        dyeStart = dItem.startDate || '';
        dyeEnd = dItem.endDate || '';
        dyeType = dItem.planType || '';
      }
    }

    return { knitStart, knitEnd, knitType, dyeStart, dyeEnd, dyeType };
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
