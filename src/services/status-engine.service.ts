import { Order } from '../models/Order.model.js';
import { OrderDate } from '../models/OrderDate.model.js';

export class StatusEngineService {
  /**
   * Recalculates plan statuses across all orders based on saved OrderDate plans
   */
  static async recalcAllPlanStatuses(): Promise<number> {
    try {
      const plans = await OrderDate.find(
        {},
        {
          orderNo: 1,
          knitting: 1,
          knittingStatus: 1,
          dyeing: 1,
          dyeingStatus: 1,
          finishing: 1,
          finishingStatus: 1,
          delivery: 1,
          deliveryStatus: 1,
          yd: 1,
          ydStatus: 1,
        }
      ).lean();

      const bulkOps: any[] = [];
      const depts = ['knitting', 'dyeing', 'finishing', 'delivery', 'yd'] as const;

      for (const plan of plans) {
        const update: Record<string, string> = {};

        for (const dept of depts) {
          const items = (plan as any)[dept];
          const savedStatus = (plan as any)[`${dept}Status`];

          if (savedStatus === 'Completed') {
            update[`${dept}PlanStatus`] = 'Completed';
          } else if (items && Array.isArray(items) && items.length > 0) {
            let hasSelect = false;
            let hasTentative = false;
            let confirmCount = 0;

            items.forEach((item: any) => {
              const planType = item.planType;
              if (!planType || planType === '' || planType === 'Select') {
                hasSelect = true;
              } else if (planType === 'Tentative') {
                hasTentative = true;
              } else if (planType === 'Confirm') {
                confirmCount++;
              }
            });

            if (hasSelect) {
              update[`${dept}PlanStatus`] = 'Pending';
            } else if (hasTentative) {
              update[`${dept}PlanStatus`] = 'Tentative';
            } else if (confirmCount === items.length) {
              update[`${dept}PlanStatus`] = 'Confirm';
            } else {
              update[`${dept}PlanStatus`] = 'Pending';
            }
          }
        }

        if (Object.keys(update).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { orderNo: plan.orderNo },
              update: { $set: update },
            },
          });
        }
      }

      if (bulkOps.length > 0) {
        for (let i = 0; i < bulkOps.length; i += 500) {
          await Order.bulkWrite(bulkOps.slice(i, i + 500), { ordered: false });
        }
      }

      return bulkOps.length;
    } catch (err: any) {
      console.error('Error recalculating plan statuses:', err.message);
      return 0;
    }
  }

  /**
   * Recalculates plan status for a single order instantly
   */
  static async recalcSingleOrder(
    orderNo: string,
    department: string,
    fabricItems: any[],
    orderStatus?: string
  ): Promise<string> {
    const dept = department.replace('Actual', '');
    if (!['knitting', 'dyeing', 'finishing', 'delivery', 'yd'].includes(dept)) {
      return 'Pending';
    }

    let calculatedStatus = 'Pending';

    if (orderStatus === 'Completed') {
      calculatedStatus = 'Completed';
    } else if (fabricItems && Array.isArray(fabricItems) && fabricItems.length > 0) {
      let hasSelect = false;
      let hasTentative = false;
      let confirmCount = 0;

      fabricItems.forEach((item: any) => {
        const pt = item.planType;
        if (!pt || pt === '' || pt === 'Select') hasSelect = true;
        else if (pt === 'Tentative') hasTentative = true;
        else if (pt === 'Confirm') confirmCount++;
      });

      if (hasSelect) calculatedStatus = 'Pending';
      else if (hasTentative) calculatedStatus = 'Tentative';
      else if (confirmCount === fabricItems.length) calculatedStatus = 'Confirm';
      else calculatedStatus = 'Pending';
    }

    await Order.updateOne(
      { orderNo },
      { $set: { [`${dept}PlanStatus`]: calculatedStatus } }
    );

    return calculatedStatus;
  }
}
