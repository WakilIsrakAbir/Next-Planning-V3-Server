import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { DeptValidOrders } from '../src/models/DeptValidOrders.model.js';
import { Order } from '../src/models/Order.model.js';
import { OrderDate } from '../src/models/OrderDate.model.js';
import { User } from '../src/models/User.model.js';
import { OrderService } from '../src/services/order.service.js';
import { fingerprintDept } from '../src/utils/plan-fingerprint.js';
import { createTestUser, requestJson, startApp, type RunningApp } from './helpers/http.js';
import { clearCollections, closeTestDb, openTestDb, rawCollection } from './helpers/local-mongo.js';
import { insertOrder, planRows } from './helpers/plan-data.js';

vi.mock('../src/config/env.js', () => import('./helpers/test-env.js'));

/** US-11: planExtras (save-plans `extras`), the Delivery Floor / Lock lists and the scope=all search. */

const DB = 'v3t_s11_us11';
let running: RunningApp;
let token = '';

const post = (path: string, body: unknown) => requestJson(running.baseUrl, 'POST', path, token, body);
const get = (path: string) => requestJson(running.baseUrl, 'GET', path, token);

beforeAll(async () => {
  await openTestDb(DB, [Order, OrderDate, User, DeptValidOrders]);
  running = await startApp(app);
  token = await createTestUser('Admin', 'v3t_us11_admin');
});

afterAll(async () => {
  if (running) await running.close();
  await closeTestDb();
});

beforeEach(async () => {
  await clearCollections(['orders', 'orderdates', 'deptvalidorders']);
  OrderService.clearReportCache();
});

const DOTTED = 'v3t-x1_s.oliver-3907(19-1321tcx)_1x1rib_280';

describe('save-plans extras -> OrderDate.planExtras', () => {
  it('stores each department map in the same write as the rows, and GET details returns it', async () => {
    await insertOrder('V3T-X1');
    const knitRows = planRows('V3T-X1', 'knitting', 2);
    const dyeRows = planRows('V3T-X1', 'dyeing', 1);
    const res = await post('/api/orders/save-plans', {
      orderNo: 'V3T-X1',
      plans: [
        { department: 'knitting', fabricItems: knitRows, extras: { [knitRows[0].itemId]: { actualYarnDate: '2026-11-30' }, [DOTTED]: { actualYarnDate: '' } } },
        { department: 'dyeing', fabricItems: dyeRows, extras: { [dyeRows[0].itemId]: { ldPlanDate: '2026-12-01', actualLdDate: '' } } },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.planData.planExtras).toEqual({
      knitting: { [knitRows[0].itemId]: { actualYarnDate: '2026-11-30' }, [DOTTED]: { actualYarnDate: '' } },
      dyeing: { [dyeRows[0].itemId]: { ldPlanDate: '2026-12-01', actualLdDate: '' } },
    });
    // rows stay exactly as sent (no extra keys in them)
    const raw = await rawCollection('orderdates').findOne({ orderNo: 'V3T-X1' });
    expect(raw!.knitting).toEqual(knitRows);

    const detail = await get('/api/orders/V3T-X1?dept=knitting&fresh=1');
    expect(detail.status).toBe(200);
    expect(detail.body.planData.planExtras).toEqual(res.body.planData.planExtras);
    expect(detail.body.fingerprints).toEqual(res.body.fingerprints);
  });

  it('leaves the stored map untouched when extras are absent, and replaces it whole when sent', async () => {
    await insertOrder('V3T-X2');
    const rows = planRows('V3T-X2', 'knitting', 2);
    const first = { [rows[0].itemId]: { actualYarnDate: '2026-11-30' }, [rows[1].itemId]: { actualYarnDate: '2026-11-29' } };
    await post('/api/orders/save-plans', { orderNo: 'V3T-X2', plans: [{ department: 'knitting', fabricItems: rows, extras: first }] });

    const noExtras = await post('/api/orders/save-plans', { orderNo: 'V3T-X2', plans: [{ department: 'knitting', fabricItems: rows }] });
    expect(noExtras.body.planData.planExtras).toEqual({ knitting: first });

    const second = { [rows[1].itemId]: { actualYarnDate: '2026-12-02' } };
    const replaced = await post('/api/orders/save-plans', { orderNo: 'V3T-X2', plans: [{ department: 'knitting', fabricItems: rows, extras: second }] });
    expect(replaced.body.planData.planExtras).toEqual({ knitting: second });
  });

  it.each([
    ['a department without extras', 'finishing', { a: { actualYarnDate: '2026-11-30' } }],
    ['a field of another department', 'knitting', { a: { ldPlanDate: '2026-11-30' } }],
    ['an unknown field', 'dyeing', { a: { yarnDate: '2026-11-30' } }],
    ['a value that is not YYYY-MM-DD', 'knitting', { a: { actualYarnDate: '30/11/2026' } }],
    ['an impossible month', 'dyeing', { a: { actualLdDate: '2026-13-01' } }],
    ['a non-string value', 'knitting', { a: { actualYarnDate: 5 } }],
    ['a non-object item', 'knitting', { a: '2026-11-30' }],
    ['an item id starting with $', 'knitting', { $a: { actualYarnDate: '' } }],
  ])('refuses %s with 400 INVALID and writes nothing', async (_label, department, extras) => {
    await insertOrder('V3T-X3', { knitting: 1, dyeing: 1, finishing: 1 });
    const res = await post('/api/orders/save-plans', {
      orderNo: 'V3T-X3',
      plans: [{ department, fabricItems: planRows('V3T-X3', department as any, 1), extras }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID');
    expect(await rawCollection('orderdates').countDocuments({ orderNo: 'V3T-X3' })).toBe(0);
  });

  it('the conflict check counts extras: a stale base is refused, an identical extras save passes', async () => {
    await insertOrder('V3T-X4');
    const rows = planRows('V3T-X4', 'knitting', 1);
    const opened = await get('/api/orders/V3T-X4?fresh=1');
    const base = { knitting: opened.body.fingerprints.knitting };
    const extrasA = { [rows[0].itemId]: { actualYarnDate: '2026-11-30' } };
    expect((await post('/api/orders/save-plans', { orderNo: 'V3T-X4', plans: [{ department: 'knitting', fabricItems: rows, extras: extrasA }], base })).status).toBe(200);

    // Same base, same rows and same extras: already stored, so no conflict.
    const again = await post('/api/orders/save-plans', { orderNo: 'V3T-X4', plans: [{ department: 'knitting', fabricItems: rows, extras: extrasA }], base });
    expect(again.status).toBe(200);
    // Same base, other extras: someone changed the department since the page loaded it.
    const other = { [rows[0].itemId]: { actualYarnDate: '2026-12-05' } };
    const stale = await post('/api/orders/save-plans', { orderNo: 'V3T-X4', plans: [{ department: 'knitting', fabricItems: rows, extras: other }], base });
    expect(stale.status).toBe(409);
    expect(stale.body.departments).toEqual(['knitting']);
  });
});

describe('fingerprintDept with planExtras', () => {
  const doc = { knitting: [{ itemId: 'a', planType: 'Confirm' }], knittingStatus: 'On Process' };

  it('keeps the old fingerprint when the map is absent, empty or only blanks, or belongs to another department', () => {
    const before = fingerprintDept(doc, 'knitting');
    expect(fingerprintDept({ ...doc, planExtras: {} }, 'knitting')).toBe(before);
    expect(fingerprintDept({ ...doc, planExtras: { knitting: {} } }, 'knitting')).toBe(before);
    expect(fingerprintDept({ ...doc, planExtras: { knitting: { a: { actualYarnDate: '' } } } }, 'knitting')).toBe(before);
    expect(fingerprintDept({ ...doc, planExtras: { dyeing: { a: { ldPlanDate: '2026-11-30' } } } }, 'knitting')).toBe(before);
    expect(fingerprintDept({ ...doc, planExtras: null }, 'knitting')).toBe(before);
  });

  it('changes with a non-empty value, ignoring the key order of items and fields', () => {
    const before = fingerprintDept(doc, 'knitting');
    const one = { ...doc, planExtras: { knitting: { a: { actualYarnDate: '2026-11-30' }, b: { actualYarnDate: '2026-11-29', x: '1' } } } };
    const swapped = { ...doc, planExtras: { knitting: { b: { x: '1', actualYarnDate: '2026-11-29' }, a: { actualYarnDate: '2026-11-30' } } } };
    const other = { ...doc, planExtras: { knitting: { a: { actualYarnDate: '2026-12-01' }, b: { actualYarnDate: '2026-11-29', x: '1' } } } };
    expect(fingerprintDept(one, 'knitting')).not.toBe(before);
    expect(fingerprintDept(swapped, 'knitting')).toBe(fingerprintDept(one, 'knitting'));
    expect(fingerprintDept(other, 'knitting')).not.toBe(fingerprintDept(one, 'knitting'));
  });
});

/** Delivery orders with saved Delivery rows of the given Lock (planType) and Floor (floorPlanType) types. */
async function deliveryOrder(orderNo: string, lock: string[] | null, floor: string[] = [], deliveryStatus = 'On Process') {
  await insertOrder(orderNo, { delivery: 2, knitting: 1 });
  if (!lock) return;
  const rows = lock.map((planType, i) => ({ itemId: `${orderNo}_${i}`, planType, floorPlanType: floor[i] ?? '' }));
  await OrderDate.create({ orderNo, delivery: rows, deliveryStatus });
}

describe('GET /api/orders?dept=deliveryfloor | deliverylock', () => {
  beforeEach(async () => {
    await deliveryOrder('V3T-D1', ['Confirm', 'Confirm'], ['Tentative', 'Confirm']); // Lock Confirm, Floor Tentative
    await deliveryOrder('V3T-D2', ['Tentative', 'Confirm'], ['Confirm', 'Confirm']); // Lock Tentative, Floor Confirm
    await deliveryOrder('V3T-D3', ['Confirm', 'Select'], ['', 'Confirm']); // both Pending
    await deliveryOrder('V3T-D4', ['Tentative', 'Tentative'], ['Tentative', ''], 'Completed'); // both Completed
    await deliveryOrder('V3T-D5', null); // no OrderDate: Pending
    await deliveryOrder('V3T-D6', []); // no rows: Pending
    await insertOrder('V3T-K1', { knitting: 1 }); // not a Delivery order
  });

  const list = async (dept: string, status: string, extra = '') => {
    const res = await get(`/api/orders?dept=${dept}&status=${status}${extra}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const numbers = (body: any) => body.orders.map((o: any) => o.orderNo);

  it('computes the Lock status from planType and the Floor status from floorPlanType', async () => {
    expect(numbers(await list('deliverylock', 'Confirm'))).toEqual(['V3T-D1']);
    expect(numbers(await list('deliverylock', 'Tentative'))).toEqual(['V3T-D2']);
    expect(numbers(await list('deliverylock', 'Pending'))).toEqual(['V3T-D6', 'V3T-D5', 'V3T-D3']);
    expect(numbers(await list('deliverylock', 'Completed'))).toEqual(['V3T-D4']);

    const floorConfirm = await list('deliveryfloor', 'Confirm');
    expect(numbers(floorConfirm)).toEqual(['V3T-D2']);
    expect(floorConfirm.orders[0].deliveryfloorPlanStatus).toBe('Confirm');
    expect(numbers(await list('deliveryfloor', 'Tentative'))).toEqual(['V3T-D1']);
    expect(numbers(await list('deliveryfloor', 'Pending'))).toEqual(['V3T-D6', 'V3T-D5', 'V3T-D3']);
    expect(numbers(await list('deliveryfloor', 'Completed'))).toEqual(['V3T-D4']);
  });

  it('keeps the list response shape, counts and pages in memory, and follows the Delivery latest file', async () => {
    const page1 = await list('deliverylock', 'Pending', '&page=1&limit=2');
    expect(Object.keys(page1).sort()).toEqual(['buyers', 'limit', 'orders', 'page', 'total', 'totalPages']);
    expect(page1).toMatchObject({ total: 3, page: 1, limit: 2, totalPages: 2, buyers: ['V3T BUYER'] });
    expect(numbers(page1)).toEqual(['V3T-D6', 'V3T-D5']);
    expect(page1.orders[0].deliverylockPlanStatus).toBe('Pending');
    expect(numbers(await list('deliverylock', 'Pending', '&page=2&limit=2'))).toEqual(['V3T-D3']);

    await DeptValidOrders.create({ dept: 'delivery', validOrderNos: ['V3T-D3', 'V3T-D1'] });
    OrderService.clearReportCache();
    expect(numbers(await list('deliverylock', 'Pending'))).toEqual(['V3T-D3']);
    expect(numbers(await list('deliverylock', 'Pending', '&search=d5'))).toEqual([]);
  });

  it('leaves dept=delivery on the stored deliveryPlanStatus', async () => {
    await Order.updateOne({ orderNo: 'V3T-D1' }, { $set: { deliveryPlanStatus: 'Tentative' } });
    expect(numbers(await list('delivery', 'Tentative'))).toEqual(['V3T-D1']);
  });

  it('accepts the split keys for the order details and the buyers', async () => {
    const res = await get('/api/orders/V3T-D1?dept=deliverylock');
    expect(res.status).toBe(200);
    expect(res.body.deptFlags.delivery.hasItems).toBe(true);
    expect((await get('/api/orders/buyers/deliveryfloor')).body).toEqual(['V3T BUYER']);
  });
});

describe('GET /api/orders?search=X&scope=all', () => {
  it('searches every status list and gives each order its status', async () => {
    await insertOrder('V3T-S1', { knitting: 1 });
    await insertOrder('V3T-S2', { knitting: 1 });
    await insertOrder('V3T-S3', { knitting: 1 });
    await Order.updateOne({ orderNo: 'V3T-S1' }, { $set: { knittingPlanStatus: 'Confirm' } });
    await Order.updateOne({ orderNo: 'V3T-S2' }, { $set: { knittingPlanStatus: 'Completed' } });
    await rawCollection('orders').updateOne({ orderNo: 'V3T-S3' }, { $unset: { knittingPlanStatus: '' } });

    const res = await get('/api/orders?dept=knitting&status=Pending&search=v3t-s&scope=all');
    expect(res.status).toBe(200);
    expect(res.body.orders.map((o: any) => [o.orderNo, o.knittingPlanStatus])).toEqual([
      ['V3T-S3', 'Pending'],
      ['V3T-S2', 'Completed'],
      ['V3T-S1', 'Confirm'],
    ]);
    expect(res.body.total).toBe(3);

    // Without scope=all the status tab still filters.
    const pending = await get('/api/orders?dept=knitting&status=Pending&search=v3t-s');
    expect(pending.body.orders.map((o: any) => o.orderNo)).toEqual(['V3T-S3']);
  });

  it('computes the Delivery Floor / Lock statuses', async () => {
    await deliveryOrder('V3T-S4', ['Confirm', 'Confirm'], ['Tentative', 'Tentative']);
    await deliveryOrder('V3T-S5', null);
    const lock = await get('/api/orders?dept=deliverylock&status=Pending&search=v3t-s&scope=all');
    expect(lock.body.orders.map((o: any) => [o.orderNo, o.deliverylockPlanStatus])).toEqual([
      ['V3T-S5', 'Pending'],
      ['V3T-S4', 'Confirm'],
    ]);
    const floor = await get('/api/orders?dept=deliveryfloor&search=v3t-s4&scope=all');
    expect(floor.body.orders.map((o: any) => [o.orderNo, o.deliveryfloorPlanStatus])).toEqual([['V3T-S4', 'Tentative']]);
  });
});
