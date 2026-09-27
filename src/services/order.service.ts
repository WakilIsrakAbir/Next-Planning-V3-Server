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
   * Retrieves tracking data matching Exp specification (planDocs, orderMap, and merged orders)
   */
  static async getTrackingData(params: {
    dept: string;
    page?: number;
    limit?: number;
    buyer?: string;
    search?: string;
    all?: string;
    status?: string;
    exact?: string;
    startMin?: string;
    startMax?: string;
    endMin?: string;
    endMax?: string;
    allowedRawBuyers?: string[];
  }): Promise<{
    planDocs: any[];
    orderMap: Record<string, any>;
    orders: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    buyers: string[];
  }> {
    const {
      dept,
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
      allowedRawBuyers,
    } = params;

    const pageNum = Math.max(1, page);
    const limitNum = Math.max(1, limit || 10);
    const noLimit = all === 'true' || limit === 0;
    const skip = noLimit ? 0 : (pageNum - 1) * limitNum;

    const dbDept = dept === 'deliveryfloor' ? 'delivery' : dept;
    const statusField = `${dbDept}PlanStatus`;
    const actualField = (dept === 'deliveryfloor' ? 'delivery' : dept) + 'Actual';

    // 1. Get Confirmed orders from Order collection
    const orderFilter: Record<string, any> = { [statusField]: 'Confirm' };

    const deptValid = await DeptValidOrders.findOne({ dept: dbDept }).lean();
    if (deptValid && deptValid.validOrderNos && deptValid.validOrderNos.length > 0) {
      orderFilter.orderNo = { $in: deptValid.validOrderNos };
    }

    if (buyer) orderFilter.buyer = { $regex: buyer, $options: 'i' };
    if (search && search.trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = exact === 'true' ? `^${escaped}$` : escaped;
      const searchRegex = new RegExp(pattern, 'i');

      if (orderFilter.orderNo && orderFilter.orderNo.$in) {
        orderFilter.orderNo.$in = orderFilter.orderNo.$in.filter((no: string) => searchRegex.test(no));
      } else {
        orderFilter.orderNo = { $regex: pattern, $options: 'i' };
      }
    }

    if (allowedRawBuyers) {
      if (orderFilter.buyer) {
        orderFilter.$and = orderFilter.$and || [];
        orderFilter.$and.push({ buyer: orderFilter.buyer });
        orderFilter.$and.push({ buyer: { $in: allowedRawBuyers } });
        delete orderFilter.buyer;
      } else {
        orderFilter.buyer = { $in: allowedRawBuyers };
      }
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

    // 2. Find orphaned tracking data in OrderDate
    const orphanMatch: any[] = [{ orderNo: { $nin: orderNos } }];
    if (search && search.trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = exact === 'true' ? `^${escaped}$` : escaped;
      orphanMatch.push({ orderNo: { $regex: pattern, $options: 'i' } });
    }

    const orphanFilter = {
      $and: orphanMatch,
      $or: [
        { [`${dbDept}Status`]: 'Confirm' },
        { [`${actualField}.actualStart`]: { $exists: true, $ne: '' } },
        { [`${actualField}.actualEnd`]: { $exists: true, $ne: '' } },
        { [`${actualField}.failReason`]: { $exists: true, $ne: '' } },
        { [`${actualField}.relatedDept`]: { $exists: true, $ne: '' } },
      ],
    };

    const orphanedDocs = await OrderDate.find(orphanFilter, { orderNo: 1, [actualField]: 1 }).lean();

    const orphanedOrderNos = orphanedDocs.map((d) => d.orderNo);
    let orphanedOrderInfos: any[] = [];
    if (orphanedOrderNos.length > 0) {
      const orphanOrderFilter: Record<string, any> = { orderNo: { $in: orphanedOrderNos } };
      if (buyer) orphanOrderFilter.buyer = { $regex: buyer, $options: 'i' };

      if (allowedRawBuyers) {
        if (orphanOrderFilter.buyer) {
          orphanOrderFilter.$and = orphanOrderFilter.$and || [];
          orphanOrderFilter.$and.push({ buyer: orphanOrderFilter.buyer });
          orphanOrderFilter.$and.push({ buyer: { $in: allowedRawBuyers } });
          delete orphanOrderFilter.buyer;
        } else {
          orphanOrderFilter.buyer = { $in: allowedRawBuyers };
        }
      }

      orphanedOrderInfos = await Order.find(orphanOrderFilter, {
        orderNo: 1,
        buyer: 1,
        bookingDate: 1,
      }).lean();
    }

    let filteredOrphanedDocs = orphanedDocs;
    if (buyer || allowedRawBuyers) {
      const orphanedWithBuyer = new Set(orphanedOrderInfos.map((o) => o.orderNo));
      filteredOrphanedDocs = orphanedDocs.filter((d) => orphanedWithBuyer.has(d.orderNo));
    }

    const allTrackingOrderNos = [...orderNos, ...filteredOrphanedDocs.map((d) => d.orderNo)];

    if (allTrackingOrderNos.length === 0) {
      return {
        planDocs: [],
        orderMap: {},
        orders: [],
        total: 0,
        page: 1,
        limit: limitNum,
        totalPages: 0,
        buyers: [],
      };
    }

    // 4. Fetch lightweight plan tracking info
    const planTrackingInfo: any[] =
      orderNos.length > 0
        ? await OrderDate.find({ orderNo: { $in: orderNos } }, { orderNo: 1, [actualField]: 1 }).lean()
        : [];

    const planDocSet = new Set(planTrackingInfo.map((p) => p.orderNo));
    orderNos.forEach((orderNo) => {
      if (!planDocSet.has(orderNo)) {
        planTrackingInfo.push({ orderNo });
        planDocSet.add(orderNo);
      }
    });

    filteredOrphanedDocs.forEach((doc) => {
      if (!planDocSet.has(doc.orderNo)) {
        planTrackingInfo.push(doc);
        planDocSet.add(doc.orderNo);
      }
    });

    // 5. Filter by Pending / Complete status
    let filteredPlanInfo = planTrackingInfo;
    if (status === 'Pending' || status === 'Complete') {
      filteredPlanInfo = planTrackingInfo.filter((plan) => {
        const actual = plan[actualField];
        const hasActualEnd = actual && actual.actualEnd && actual.actualEnd.trim() !== '' && actual.actualEnd !== '-';
        if (status === 'Pending') return !hasActualEnd;
        if (status === 'Complete') return hasActualEnd;
        return true;
      });
    }

    // Date range filtering
    const hasDateFilter = startMin || startMax || endMin || endMax;
    if (hasDateFilter && filteredPlanInfo.length > 0) {
      const filterOrderNos = filteredPlanInfo.map((p) => p.orderNo);
      const filterDocs = await OrderDate.find({ orderNo: { $in: filterOrderNos } }, { orderNo: 1, [dbDept]: 1 }).lean();
      const filterOrders = await Order.find(
        { orderNo: { $in: filterOrderNos } },
        {
          orderNo: 1,
          [`${dbDept}Items`]: 1,
          knitStart: 1,
          knitEnd: 1,
          dyeStart: 1,
          dyeEnd: 1,
          deliStart: 1,
          deliEnd: 1,
        }
      ).lean();

      const filterOrdersMap: Record<string, any> = {};
      filterOrders.forEach((o) => {
        filterOrdersMap[o.orderNo] = o;
      });

      filteredPlanInfo = filteredPlanInfo.filter((plan: any) => {
        const doc = filterDocs.find((d: any) => d.orderNo === plan.orderNo) as any;
        const orderInfo = filterOrdersMap[plan.orderNo] || {};
        const rawItems = doc && doc[dbDept] && doc[dbDept].length > 0 ? doc[dbDept] : (orderInfo as any)[`${dbDept}Items`] || [];

        let startDates: string[] = [];
        let endDates: string[] = [];

        if (dept === 'deliveryfloor') {
          const floorItems = rawItems.filter((item: any) => {
            const type = item.floorPlanType || item['Delivery Plan Type (Floor)'] || '';
            return type === 'Confirm' || type === 'Tentative';
          });
          startDates = floorItems.map((item: any) => item.floorStartDate || item['Delivery Plan Start (Floor)'] || '').filter(Boolean);
          endDates = floorItems.map((item: any) => item.floorEndDate || item['Delivery Plan End (Floor)'] || '').filter(Boolean);
        } else {
          startDates = rawItems
            .map((item: any) => item.startDate || item['Plan Start Date'] || item['Plan Start'] || item['Start Date'] || '')
            .filter(Boolean);
          endDates = rawItems
            .map((item: any) => item.endDate || item['Plan End Date'] || item['Plan End'] || item['End Date'] || '')
            .filter(Boolean);
        }

        if (startDates.length === 0 && endDates.length === 0) {
          if (dept === 'knitting') {
            if (orderInfo.knitStart) startDates = [orderInfo.knitStart];
            if (orderInfo.knitEnd) endDates = [orderInfo.knitEnd];
          } else if (dept === 'dyeing') {
            if (orderInfo.dyeStart) startDates = [orderInfo.dyeStart];
            if (orderInfo.dyeEnd) endDates = [orderInfo.dyeEnd];
          } else if (dept === 'delivery' || dept === 'deliveryfloor') {
            if (orderInfo.deliStart) startDates = [orderInfo.deliStart];
            if (orderInfo.deliEnd) endDates = [orderInfo.deliEnd];
          }
        }

        startDates.sort();
        endDates.sort();
        const pStart = startDates.length > 0 ? startDates[0] : '';
        const pEnd = endDates.length > 0 ? endDates[endDates.length - 1] : '';

        if (startMin && pStart && new Date(pStart).setHours(0, 0, 0, 0) < new Date(startMin).setHours(0, 0, 0, 0)) return false;
        if (startMin && !pStart) return false;

        if (startMax && pStart && new Date(pStart).setHours(0, 0, 0, 0) > new Date(startMax).setHours(0, 0, 0, 0)) return false;
        if (startMax && !pStart) return false;

        if (endMin && pEnd && new Date(pEnd).setHours(0, 0, 0, 0) < new Date(endMin).setHours(0, 0, 0, 0)) return false;
        if (endMin && !pEnd) return false;

        if (endMax && pEnd && new Date(pEnd).setHours(0, 0, 0, 0) > new Date(endMax).setHours(0, 0, 0, 0)) return false;
        if (endMax && !pEnd) return false;

        return true;
      });
    }

    // 6. Build orderMap
    const orderMap: Record<string, any> = {};
    confirmedOrders.forEach((o) => {
      orderMap[o.orderNo] = o;
    });
    orphanedOrderInfos.forEach((o) => {
      if (!orderMap[o.orderNo]) orderMap[o.orderNo] = o;
    });

    // 7. Get all buyers for filter dropdown
    const allBuyersList = await Order.distinct('buyer', { [statusField]: 'Confirm' });
    orphanedOrderInfos.forEach((o) => {
      if (o.buyer) allBuyersList.push(o.buyer);
    });
    const buyers = [
      ...new Set(
        allBuyersList.filter((b) => b && b.trim() !== '' && b !== 'N/A').map((b) => b.trim().toUpperCase())
      ),
    ].sort();

    // 8. Pagination
    const totalFiltered = filteredPlanInfo.length;
    const paginatedInfo = noLimit ? filteredPlanInfo : filteredPlanInfo.slice(skip, skip + limitNum);
    const paginatedOrderNos = paginatedInfo.map((p) => p.orderNo);

    // 9. Fetch HEAVY plan data for paginated orderNos
    let paginatedDocs: any[] = [];
    if (paginatedOrderNos.length > 0) {
      const projection: Record<string, any> = {
        orderNo: 1,
        [dbDept]: 1,
        [`${dbDept}Status`]: 1,
        [`${dbDept}CompletedDate`]: 1,
        [actualField]: 1,
      };
      if (dept === 'dyeing' || dept === 'delivery' || dept === 'deliveryfloor') {
        projection.dyeing = 1;
      }
      paginatedDocs = await OrderDate.find({ orderNo: { $in: paginatedOrderNos } }, projection).lean();
    }

    const heavyDocSet = new Set(paginatedDocs.map((p) => p.orderNo));
    paginatedOrderNos.forEach((orderNo) => {
      if (!heavyDocSet.has(orderNo)) {
        paginatedDocs.push({ orderNo, [dbDept]: [] });
      }
    });

    const orderProjection: Record<string, any> = { orderNo: 1, [`${dbDept}Items`]: 1 };
    if (dept === 'delivery' || dept === 'deliveryfloor') {
      orderProjection.dyeingItems = 1;
    }
    const paginatedOrders = await Order.find({ orderNo: { $in: paginatedOrderNos } }, orderProjection).lean();
    const paginatedOrdersMap: Record<string, any> = {};
    const paginatedDyeingOrdersMap: Record<string, any> = {};
    paginatedOrders.forEach((o: any) => {
      paginatedOrdersMap[o.orderNo] = o[`${dbDept}Items`] || [];
      if (dept === 'delivery' || dept === 'deliveryfloor') {
        paginatedDyeingOrdersMap[o.orderNo] = o.dyeingItems || [];
      }
    });

    paginatedDocs.forEach((doc) => {
      doc.uploadedItems = paginatedOrdersMap[doc.orderNo] || [];
      if (dept === 'delivery' || dept === 'deliveryfloor') {
        if (!doc.dyeing || doc.dyeing.length === 0) {
          const rawDyeing = paginatedDyeingOrdersMap[doc.orderNo] || [];
          if (rawDyeing.length > 0) {
            doc.dyeing = rawDyeing.map((raw: any) => ({ itemData: raw }));
          }
        }
      }

      if (!doc[dbDept] || doc[dbDept].length === 0) {
        const rawItems = paginatedOrdersMap[doc.orderNo] || [];
        doc[dbDept] = rawItems.map((raw: any) => {
          let startDate =
            raw['Plan Start Date'] ||
            raw['Plan Start'] ||
            raw['Start Date'] ||
            raw['Knit Start Date'] ||
            raw['Dyeing Start Date'] ||
            '';
          let endDate =
            raw['Plan End Date'] ||
            raw['Plan End'] ||
            raw['End Date'] ||
            raw['Knit End Date'] ||
            raw['Dyeing End Date'] ||
            '';

          if (dbDept === 'delivery') {
            startDate = raw['Delivery Plan Start'] || startDate;
            endDate = raw['Delivery Plan End'] || endDate;
            return {
              itemData: raw,
              floorStartDate: raw['Delivery Plan Start (Floor)'] || '',
              floorEndDate: raw['Delivery Plan End (Floor)'] || '',
              floorPlanType: raw['Delivery Plan Type (Floor)'] || '',
              startDate,
              endDate,
            };
          }
          return {
            itemData: raw,
            startDate,
            endDate,
          };
        });
      }
    });

    // Populate unit and processName for dyeing, delivery, deliveryfloor
    if (dept === 'dyeing' || dept === 'delivery' || dept === 'deliveryfloor') {
      const invalidStrings = new Set(['', '-', 'n/a', 'select', 'null', 'undefined']);
      paginatedDocs.forEach((doc) => {
        const dyeingItems =
          doc.dyeing && doc.dyeing.length > 0
            ? doc.dyeing
            : (paginatedDyeingOrdersMap[doc.orderNo] || []).map((r: any) => ({ itemData: r }));
        const units: string[] = [];
        const processes: string[] = [];

        dyeingItems.forEach((it: any) => {
          const d = it.itemData || it;
          const u =
            d.Unit !== undefined && d.Unit !== null
              ? String(d.Unit).trim()
              : it.Unit !== undefined && it.Unit !== null
              ? String(it.Unit).trim()
              : '';
          if (u) {
            u.split('+')
              .map((s: string) => s.trim())
              .filter(Boolean)
              .forEach((part: string) => {
                if (!invalidStrings.has(part.toLowerCase()) && !units.includes(part)) {
                  units.push(part);
                }
              });
          }

          const p =
            d.ProcessName ||
            d['Process Name'] ||
            d.Process ||
            it.ProcessName ||
            it['Process Name'] ||
            '';
          if (p) {
            String(p)
              .trim()
              .split('+')
              .map((s: string) => s.trim())
              .filter(Boolean)
              .forEach((part: string) => {
                if (!invalidStrings.has(part.toLowerCase()) && !processes.includes(part)) {
                  processes.push(part);
                }
              });
          }
        });

        doc.unit = units.join('+');
        doc.processName = processes.join('+');
      });
    }

    const finalPaginatedDocs: any[] = [];
    paginatedOrderNos.forEach((orderNo) => {
      const doc = paginatedDocs.find((d) => d.orderNo === orderNo);
      if (doc) finalPaginatedDocs.push(doc);
    });

    const paginatedOrderMap: Record<string, any> = {};
    finalPaginatedDocs.forEach((p) => {
      if (orderMap[p.orderNo]) paginatedOrderMap[p.orderNo] = orderMap[p.orderNo];
    });

    // Merged orders for standard list consumption in Tracking Page
    const mergedOrders = finalPaginatedDocs.map((doc: any) => {
      const oInfo = paginatedOrderMap[doc.orderNo] || {};
      const actual = doc[actualField] || {};
      const deptItems = doc[dbDept] || [];

      let startDates: string[] = [];
      let endDates: string[] = [];
      if (dept === 'deliveryfloor') {
        const floorItems = deptItems.filter((item: any) => {
          const type = item.floorPlanType || item['Delivery Plan Type (Floor)'] || '';
          return type === 'Confirm' || type === 'Tentative';
        });
        startDates = floorItems.map((i: any) => i.floorStartDate || i['Delivery Plan Start (Floor)'] || '').filter(Boolean);
        endDates = floorItems.map((i: any) => i.floorEndDate || i['Delivery Plan End (Floor)'] || '').filter(Boolean);
      } else {
        startDates = deptItems.map((i: any) => i.startDate || i['Plan Start Date'] || i['Start Date'] || '').filter(Boolean);
        endDates = deptItems.map((i: any) => i.endDate || i['Plan End Date'] || i['End Date'] || '').filter(Boolean);
      }

      if (startDates.length === 0 && endDates.length === 0) {
        if (dept === 'knitting') {
          if (oInfo.knitStart) startDates = [oInfo.knitStart];
          if (oInfo.knitEnd) endDates = [oInfo.knitEnd];
        } else if (dept === 'dyeing') {
          if (oInfo.dyeStart) startDates = [oInfo.dyeStart];
          if (oInfo.dyeEnd) endDates = [oInfo.dyeEnd];
        } else if (dept === 'delivery' || dept === 'deliveryfloor') {
          if (oInfo.deliStart) startDates = [oInfo.deliStart];
          if (oInfo.deliEnd) endDates = [oInfo.deliEnd];
        }
      }

      startDates.sort();
      endDates.sort();
      const planStart = startDates.length > 0 ? startDates[0] : '';
      const planEnd = endDates.length > 0 ? endDates[endDates.length - 1] : '';

      return {
        orderNo: doc.orderNo,
        buyer: oInfo.buyer || doc.buyer || 'N/A',
        bookingDate: oInfo.bookingDate || '',
        planStart,
        planEnd,
        actualStart: actual.actualStart || '',
        actualEnd: actual.actualEnd || '',
        failReason: actual.failReason || actual.remarks || '',
        relatedDept: actual.relatedDept || '',
        status: actual.status || (actual.actualEnd ? 'Complete' : 'Pending'),
        unit: doc.unit || '',
        processName: doc.processName || '',
        planItems: deptItems,
      };
    });

    return {
      planDocs: finalPaginatedDocs,
      orderMap: paginatedOrderMap,
      orders: mergedOrders,
      total: totalFiltered,
      page: noLimit ? 1 : pageNum,
      limit: noLimit ? totalFiltered : limitNum,
      totalPages: noLimit ? 1 : Math.ceil(totalFiltered / limitNum),
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
