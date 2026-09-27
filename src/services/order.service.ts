import { Order, IOrder, PlanStatus } from '../models/Order.model.js';
import { OrderDate, IOrderDate } from '../models/OrderDate.model.js';
import { DeptValidOrders } from '../models/DeptValidOrders.model.js';
import { StatusEngineService } from './status-engine.service.js';

export interface IPaginatedOrdersResult {
  orders: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  buyers?: string[];
}

export class OrderService {
  /**
   * Retrieves unique buyer names scoped to permitted buyers
   */
  static async getUniqueBuyers(allowedRawBuyers?: string[]): Promise<string[]> {
    let buyers: string[];

    if (allowedRawBuyers) {
      buyers = allowedRawBuyers.filter((b) => b && b !== '_NONE_');
    } else {
      const rawBuyers = await Order.distinct('buyer');
      buyers = rawBuyers
        .map((b) => (b ? String(b).trim() : ''))
        .filter(
          (b) =>
            b &&
            b.toUpperCase() !== 'UNDEFINED' &&
            b.toUpperCase() !== 'N/A' &&
            b.toUpperCase() !== 'GENERAL'
        );
    }

    buyers.sort((a, b) => a.localeCompare(b));
    return buyers;
  }

  /**
   * Retrieves buyers present in a specific department's active upload file
   */
  static async getDepartmentBuyers(dept: string, allowedRawBuyers?: string[]): Promise<string[]> {
    const itemsField = `${dept}Items`;
    const filter: Record<string, any> = { [itemsField]: { $exists: true, $ne: [] } };

    const deptValid = await DeptValidOrders.findOne({ dept }).lean();
    if (deptValid?.validOrderNos && deptValid.validOrderNos.length > 0) {
      filter.orderNo = { $in: deptValid.validOrderNos };
    }

    if (allowedRawBuyers) {
      filter.buyer = { $in: allowedRawBuyers };
    }

    const buyers = await Order.distinct('buyer', filter);
    return buyers
      .filter((b) => b && b !== 'N/A' && b !== '')
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Retrieves all orders across departments (used by Order Status and PPI overview)
   */
  static async getAllOrdersList(
    page: number = 1,
    limit: number = 10,
    search: string = '',
    allowedRawBuyers?: string[]
  ): Promise<IPaginatedOrdersResult> {
    const pageNum = Math.max(1, page);
    const limitNum = Math.min(200, Math.max(1, limit));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, any> = {};

    if (allowedRawBuyers) {
      filter.buyer = { $in: allowedRawBuyers };
    }

    if (search && search.trim()) {
      filter.$or = [
        { orderNo: { $regex: search.trim(), $options: 'i' } },
        { buyer: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const projection = {
      orderNo: 1,
      buyer: 1,
      bookingDate: 1,
      status: 1,
      knittingPlanStatus: 1,
      dyeingPlanStatus: 1,
      finishingPlanStatus: 1,
      deliveryPlanStatus: 1,
      ydPlanStatus: 1,
    };

    const [orders, total] = await Promise.all([
      Order.find(filter, projection).sort({ orderNo: -1 }).skip(skip).limit(limitNum).lean(),
      Order.countDocuments(filter),
    ]);

    return {
      orders,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  /**
   * Retrieves paginated orders for a specific department and status tab
   */
  static async getDepartmentOrders(params: {
    dept?: string;
    status?: PlanStatus;
    buyer?: string;
    page?: number;
    limit?: number;
    search?: string;
    exact?: boolean;
    populateItems?: boolean;
    allowedRawBuyers?: string[];
  }): Promise<IPaginatedOrdersResult> {
    const {
      dept = 'knitting',
      status = 'Pending',
      buyer = '',
      page = 1,
      limit = 10,
      search = '',
      exact = false,
      populateItems = false,
      allowedRawBuyers,
    } = params;

    const pageNum = Math.max(1, page);
    const limitNum = Math.min(100, Math.max(1, limit));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, any> = {};

    // Filter by active uploaded file for this department
    const deptValid = await DeptValidOrders.findOne({ dept }).lean();
    if (deptValid?.validOrderNos && deptValid.validOrderNos.length > 0) {
      filter.orderNo = { $in: deptValid.validOrderNos };
    }

    // Filter by plan status
    const statusField = `${dept}PlanStatus`;
    filter[statusField] = status;

    // Only return orders that have items for this department
    const itemsField = `${dept}Items`;
    filter[itemsField] = { $exists: true, $ne: [] };

    // Filter by buyer
    if (buyer) {
      filter.buyer = buyer;
    }

    if (allowedRawBuyers) {
      if (filter.buyer) {
        if (!allowedRawBuyers.includes(filter.buyer)) {
          filter.buyer = '_NONE_';
        }
      } else {
        filter.buyer = { $in: allowedRawBuyers };
      }
    }

    // Filter by search query
    if (search && search.trim()) {
      filter.orderNo = exact
        ? { $regex: `^${search.trim()}$`, $options: 'i' }
        : { $regex: search.trim(), $options: 'i' };
    }

    // Projection
    const projection: Record<string, any> = {
      orderNo: 1,
      buyer: 1,
      bookingDate: 1,
      status: 1,
      requiredQtyKgs: 1,
      [`${dept}PlanStatus`]: 1,
    };

    if (populateItems) {
      projection[`${dept}Items`] = 1;
      projection.knitStart = 1;
      projection.knitEnd = 1;
      projection.dyeStart = 1;
      projection.dyeEnd = 1;
      projection.deliStart = 1;
      projection.deliEnd = 1;
      projection.ydStart = 1;
      projection.ydEnd = 1;
    }

    const [orders, total, buyerList] = await Promise.all([
      Order.find(filter, projection).sort({ orderNo: -1 }).skip(skip).limit(limitNum).lean(),
      Order.countDocuments(filter),
      Order.distinct('buyer', { [itemsField]: { $exists: true, $ne: [] } }),
    ]);

    const formattedBuyers = Array.from(
      new Set(
        buyerList
          .filter((b) => b && b.trim() !== '' && b !== 'N/A')
          .map((b) => b.trim().toUpperCase())
      )
    ).sort();

    return {
      orders,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      buyers: formattedBuyers,
    };
  }

  /**
   * Retrieves full details for an individual order with merged planning records
   */
  static async getOrderDetails(
    orderNo: string,
    dept?: string
  ): Promise<{ order: IOrder; planData: IOrderDate | null }> {
    const order = (await Order.findOne({ orderNo }).lean()) as any;
    if (!order) {
      throw new Error(`Order "${orderNo}" not found.`);
    }

    // Gather department items for comprehensive fallbacks
    const allItems = [
      ...(order.knittingItems || []),
      ...(order.dyeingItems || []),
      ...(order.finishingItems || []),
      ...(order.deliveryItems || []),
      ...(order.ydItems || []),
    ];

    // Fallbacks if general info was not uploaded for this order
    if ((!order.requiredQtyKgs || order.requiredQtyKgs === '') && allItems.length > 0) {
      const sum = allItems.reduce((acc: number, it: any) => {
        const q = Number(it.RequiredQtyKgs || it.requiredQtyKgs || it['Req Qty'] || it.Qty || 0);
        return acc + (isNaN(q) ? 0 : q);
      }, 0);
      if (sum > 0) order.requiredQtyKgs = sum;
    }

    if (!order.buyer && allItems.length > 0) {
      const bItem = allItems.find((it: any) => it.Buyer || it.BuyerName || it.Customer);
      if (bItem) order.buyer = bItem.Buyer || bItem.BuyerName || bItem.Customer || '';
    }

    if (!order.style && allItems.length > 0) {
      const sItem = allItems.find((it: any) => it.Style || it.style);
      if (sItem) order.style = sItem.Style || sItem.style || '';
    }

    if (!order.gmtUnit && allItems.length > 0) {
      const uItem = allItems.find((it: any) => it.Unit || it['Booking Unit'] || it.GmtUnit);
      if (uItem) order.gmtUnit = uItem.Unit || uItem['Booking Unit'] || uItem.GmtUnit || '';
    }

    if (!order.floor && allItems.length > 0) {
      const fItem = allItems.find((it: any) => it.Floor || it.floor);
      if (fItem) order.floor = fItem.Floor || fItem.floor || '';
    }

    const planData = await OrderDate.findOne({ orderNo }).lean();

    return {
      order: order as unknown as IOrder,
      planData: planData as unknown as IOrderDate | null,
    };
  }

  /**
   * Saves or updates process dates, floor actuals, and triggers status recalculation
   */
  static async savePlanningDates(payload: {
    orderNo: string;
    department: string;
    fabricItems?: any[];
    orderStatus?: string;
    completedDate?: string;
    actualData?: any;
  }): Promise<IOrderDate> {
    const { orderNo, department, fabricItems, orderStatus, completedDate, actualData } = payload;

    const updateObj: Record<string, any> = {};

    if (actualData) {
      updateObj[department] = actualData;
    } else if (fabricItems) {
      updateObj[department] = fabricItems;
    }

    if (orderStatus) updateObj[`${department}Status`] = orderStatus;
    if (completedDate !== undefined) updateObj[`${department}CompletedDate`] = completedDate;

    const updatedRecord = await OrderDate.findOneAndUpdate(
      { orderNo },
      { $set: updateObj },
      { returnDocument: 'after', upsert: true }
    );

    // Trigger instant status update
    try {
      await StatusEngineService.recalcSingleOrder(
        orderNo,
        department,
        fabricItems || [],
        orderStatus
      );

      // If floor actual was saved, store actualEnd in Order for fast tracking queries
      if (actualData && department.includes('Actual')) {
        const baseDept = department.replace('Actual', '');
        const actualEndField = `${baseDept}ActualEnd`;
        await Order.updateOne(
          { orderNo },
          { $set: { [actualEndField]: actualData.actualEnd || '' } }
        );
      }
    } catch (err: any) {
      console.warn('Status recalculation warning:', err.message);
    }

    return updatedRecord as IOrderDate;
  }

  /**
   * Retrieves confirmed orders for Plan vs Actual Tracking
   */
  static async getTrackingData(params: {
    dept: string;
    page?: number;
    limit?: number;
    buyer?: string;
    search?: string;
    startMin?: string;
    startMax?: string;
    endMin?: string;
    endMax?: string;
    allowedRawBuyers?: string[];
  }): Promise<{
    orders: any[];
    total: number;
    page: number;
    totalPages: number;
    buyers: string[];
  }> {
    const {
      dept,
      page = 1,
      limit = 10,
      buyer = '',
      search = '',
      startMin = '',
      startMax = '',
      endMin = '',
      endMax = '',
      allowedRawBuyers,
    } = params;

    const pageNum = Math.max(1, page);
    const limitNum = Math.max(1, limit);
    const skip = (pageNum - 1) * limitNum;

    const dbDept = dept === 'deliveryfloor' ? 'delivery' : dept;
    const statusField = `${dbDept}PlanStatus`;

    const orderFilter: Record<string, any> = { [statusField]: 'Confirm' };

    // Active upload file constraint
    const deptValid = await DeptValidOrders.findOne({ dept: dbDept }).lean();
    if (deptValid?.validOrderNos && deptValid.validOrderNos.length > 0) {
      orderFilter.orderNo = { $in: deptValid.validOrderNos };
    }

    if (buyer) orderFilter.buyer = { $regex: buyer, $options: 'i' };
    if (search && search.trim()) {
      orderFilter.orderNo = { $regex: search.trim(), $options: 'i' };
    }

    if (allowedRawBuyers) {
      orderFilter.buyer = { $in: allowedRawBuyers };
    }

    const confirmedOrders = await Order.find(orderFilter, {
      orderNo: 1,
      buyer: 1,
      bookingDate: 1,
      knitStart: 1,
      knitEnd: 1,
      dyeStart: 1,
      dyeEnd: 1,
      deliStart: 1,
      deliEnd: 1,
    })
      .sort({ orderNo: -1 })
      .lean();

    const orderNos = confirmedOrders.map((o) => o.orderNo);
    const planDocs = await OrderDate.find({ orderNo: { $in: orderNos } }).lean();

    const planMap = new Map<string, any>();
    planDocs.forEach((p) => planMap.set(p.orderNo, p));

    // Combine order spec with saved floor actuals and plan dates
    let mergedList: any[] = [];

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

      // Date range filters
      if (startMin && planStart && planStart < startMin) return;
      if (startMax && planStart && planStart > startMax) return;
      if (endMin && planEnd && planEnd < endMin) return;
      if (endMax && planEnd && planEnd > endMax) return;

      mergedList.push({
        orderNo: ord.orderNo,
        buyer: ord.buyer,
        bookingDate: ord.bookingDate,
        planStart,
        planEnd,
        actualStart: actual.actualStart || '',
        actualEnd: actual.actualEnd || '',
        actualProd: actual.actualProd || '',
        actualStatus: actual.status || 'Pending',
        planItems: deptPlanItems,
      });
    });

    const total = mergedList.length;
    const paginated = mergedList.slice(skip, skip + limitNum);
    const buyers = Array.from(new Set(mergedList.map((o) => o.buyer))).filter(Boolean).sort();

    return {
      orders: paginated,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      buyers,
    };
  }

  /**
   * Retrieves full report data for confirmed and tentative orders
   */
  static async getReportData(
    dept: string,
    allowedRawBuyers?: string[]
  ): Promise<{ orders: any[]; planMap: Record<string, any>; total: number }> {
    const statusField = `${dept}PlanStatus`;
    const itemsField = `${dept}Items`;

    const filter: Record<string, any> = {
      [statusField]: { $in: ['Confirm', 'Tentative'] },
      [itemsField]: { $exists: true, $ne: [] },
    };

    const deptValid = await DeptValidOrders.findOne({ dept }).lean();
    if (deptValid?.validOrderNos && deptValid.validOrderNos.length > 0) {
      filter.orderNo = { $in: deptValid.validOrderNos };
    }

    if (allowedRawBuyers) {
      filter.buyer = { $in: allowedRawBuyers };
    }

    const orders = await Order.find(filter).sort({ orderNo: -1 }).lean();
    const orderNos = orders.map((o) => o.orderNo);

    const planDocs = await OrderDate.find({ orderNo: { $in: orderNos } }).lean();
    const planMap: Record<string, any> = {};
    planDocs.forEach((p) => {
      planMap[p.orderNo] = p;
    });

    return {
      orders,
      planMap,
      total: orders.length,
    };
  }

  /**
   * Retrieves all dates (for bulk reporting / legacy caching)
   */
  static async getAllDates(): Promise<any[]> {
    return OrderDate.find().lean();
  }

  /**
   * Retrieves planning dates for specific order numbers
   */
  static async getSpecificDates(orderNos: string[], dept?: string): Promise<any[]> {
    if (!orderNos || !Array.isArray(orderNos) || orderNos.length === 0) {
      return [];
    }
    const projection: Record<string, any> = { orderNo: 1, orderData: 1 };
    if (dept) {
      projection[dept] = 1;
      projection[`${dept}Status`] = 1;
      projection[`${dept}CompletedDate`] = 1;
    } else {
      ['knitting', 'dyeing', 'finishing', 'delivery', 'yd'].forEach((d) => {
        projection[d] = 1;
        projection[`${d}Status`] = 1;
        projection[`${d}CompletedDate`] = 1;
      });
    }
    return OrderDate.find({ orderNo: { $in: orderNos } }, projection).lean();
  }

  /**
   * Retrieves dates for a specific department
   */
  static async getDeptDates(dept: string): Promise<any[]> {
    const validDepts = ['knitting', 'dyeing', 'finishing', 'delivery', 'yd'];
    if (!validDepts.includes(dept)) {
      throw new Error('Invalid department');
    }
    const filter: Record<string, any> = {};
    filter[dept] = { $exists: true, $ne: [], $type: 'array' };

    const projection: Record<string, any> = {
      orderNo: 1,
      [dept]: 1,
      [`${dept}Status`]: 1,
      [`${dept}CompletedDate`]: 1,
      [`${dept}Actual`]: 1,
    };
    return OrderDate.find(filter, projection).lean();
  }
}
