import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeptValidOrders } from '../src/models/DeptValidOrders.model.js';
import { Order } from '../src/models/Order.model.js';
import { OrderDate } from '../src/models/OrderDate.model.js';
import { OrderService } from '../src/services/order.service.js';
import { PLAN_DEPTS, UNSAVED_FINGERPRINT, fingerprintAllDepts } from '../src/utils/plan-fingerprint.js';
import { clearCollections, closeTestDb, openTestDb, rawCollection } from './helpers/local-mongo.js';
import { insertOrder, planRows } from './helpers/plan-data.js';

/** GET /api/orders/:orderNo at the service level: fingerprints, deptFlags and the fresh option. */

const DB = 'v3t_order_details';

beforeAll(async () => {
  await openTestDb(DB, [Order, OrderDate, DeptValidOrders]);
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearCollections(['orders', 'orderdates', 'deptvalidorders']);
  OrderService.clearReportCache();
});

describe('getOrderDetails', () => {
  it('returns order, planData, a fingerprint for each of the 5 departments and deptFlags', async () => {
    await insertOrder('V3T-D1', { knitting: 2, dyeing: 1 });
    await OrderService.savePlanningDates({ orderNo: 'V3T-D1', department: 'knitting', fabricItems: planRows('V3T-D1', 'knitting', 2), orderStatus: 'On Process' });
    OrderService.clearReportCache();

    const details = await OrderService.getOrderDetails('V3T-D1', 'knitting');
    expect(Object.keys(details)).toEqual(['order', 'planData', 'fingerprints', 'deptFlags']);
    expect(details.order.orderNo).toBe('V3T-D1');
    expect(details.planData!.orderNo).toBe('V3T-D1');
    expect(Object.keys(details.fingerprints)).toEqual([...PLAN_DEPTS]);
    expect(details.fingerprints).toEqual(fingerprintAllDepts(await OrderDate.findOne({ orderNo: 'V3T-D1' }).lean()));
    expect(Object.keys(details.deptFlags)).toEqual([...PLAN_DEPTS]);
  });

  it('gives the no-plan fingerprint for every department of an order without an OrderDate', async () => {
    await insertOrder('V3T-D2');
    const details = await OrderService.getOrderDetails('V3T-D2');
    expect(details.planData).toBeNull();
    expect(Object.values(details.fingerprints)).toEqual(PLAN_DEPTS.map(() => UNSAVED_FINGERPRINT));
  });

  it('deptFlags: inLatestFile follows the latest file lists, hasItems the Excel rows', async () => {
    await insertOrder('V3T-D3', { knitting: 2, dyeing: 1, delivery: 0 });
    await rawCollection('deptvalidorders').insertMany([
      { dept: 'knitting', validOrderNos: ['V3T-OTHER', 'V3T-D3'] }, // listed
      { dept: 'dyeing', validOrderNos: ['V3T-OTHER'] }, // not in the latest Dyeing file
      { dept: 'delivery', validOrderNos: [] }, // empty list: the plan list shows every order
      // yd and finishing: no list at all, so every order is shown
    ]);
    const { deptFlags } = await OrderService.getOrderDetails('V3T-D3');
    expect(deptFlags).toEqual({
      yd: { inLatestFile: true, hasItems: false },
      knitting: { inLatestFile: true, hasItems: true },
      dyeing: { inLatestFile: false, hasItems: true },
      finishing: { inLatestFile: true, hasItems: false },
      delivery: { inLatestFile: true, hasItems: false },
    });
  });

  it('uses the cached latest-file lists (getValidOrderNos)', async () => {
    await insertOrder('V3T-D4');
    const lists = vi.spyOn(OrderService, 'getValidOrderNos');
    await OrderService.getOrderDetails('V3T-D4');
    expect(lists.mock.calls.map((c) => c[0])).toEqual([...PLAN_DEPTS]);
  });

  it('serves the 60 s cache, and fresh skips reading it but refills it', async () => {
    await insertOrder('V3T-D5', { knitting: 1 });
    const first = await OrderService.getOrderDetails('V3T-D5', 'knitting');
    expect(first.planData).toBeNull();

    // A save made through another server instance (its cache clear does not reach this one).
    await rawCollection('orderdates').insertOne({ orderNo: 'V3T-D5', knitting: planRows('V3T-D5', 'knitting', 1), knittingStatus: 'Confirm' });

    const cached = await OrderService.getOrderDetails('V3T-D5', 'knitting');
    expect(cached).toBe(first);
    expect(cached.planData).toBeNull();

    const fresh = await OrderService.getOrderDetails('V3T-D5', 'knitting', { fresh: true });
    expect(fresh.planData!.knittingStatus).toBe('Confirm');
    expect(fresh.fingerprints.knitting).not.toBe(UNSAVED_FINGERPRINT);

    // The fresh read was written to the cache: a normal read now returns it.
    const after = await OrderService.getOrderDetails('V3T-D5', 'knitting');
    expect(after).toBe(fresh);
  });

  it('still throws "not found" for an unknown order', async () => {
    await expect(OrderService.getOrderDetails('V3T-NOPE')).rejects.toThrow('Order "V3T-NOPE" not found.');
    await expect(OrderService.getOrderDetails('V3T-NOPE', undefined, { fresh: true })).rejects.toThrow('Order "V3T-NOPE" not found.');
  });
});
