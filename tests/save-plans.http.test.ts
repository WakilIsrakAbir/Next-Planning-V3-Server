import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { DeptValidOrders } from '../src/models/DeptValidOrders.model.js';
import { Order } from '../src/models/Order.model.js';
import { OrderDate } from '../src/models/OrderDate.model.js';
import { User } from '../src/models/User.model.js';
import { OrderService } from '../src/services/order.service.js';
import { PLAN_DEPTS, UNSAVED_FINGERPRINT } from '../src/utils/plan-fingerprint.js';
import { createTestUser, requestJson, startApp, type RunningApp } from './helpers/http.js';
import { clearCollections, closeTestDb, openTestDb, rawCollection } from './helpers/local-mongo.js';
import { insertOrder, planRows } from './helpers/plan-data.js';

// The app's env module would read the server's .env (live database URI); tests use a stand-in.
vi.mock('../src/config/env.js', () => import('./helpers/test-env.js'));

/** The HTTP routes: POST /api/orders/save-plans and GET /api/orders/:orderNo (?fresh=1), through the Express app. */

const DB = 'v3t_save_plans_http';
let running: RunningApp;
let token = '';
let viewerToken = '';

const post = (path: string, body: unknown, auth = token) => requestJson(running.baseUrl, 'POST', path, auth, body);
const get = (path: string, auth = token) => requestJson(running.baseUrl, 'GET', path, auth);

beforeAll(async () => {
  await openTestDb(DB, [Order, OrderDate, User, DeptValidOrders]);
  running = await startApp(app);
  token = await createTestUser('Admin', 'v3t_http_admin');
  viewerToken = await createTestUser('Viewer', 'v3t_http_viewer');
});

afterAll(async () => {
  if (running) await running.close();
  await closeTestDb();
});

beforeEach(async () => {
  await clearCollections(['orders', 'orderdates', 'deptvalidorders']);
  OrderService.clearReportCache();
});

describe('POST /api/orders/save-plans', () => {
  it('saves several departments and answers 200 with planData, planStatuses, statusSynced and fingerprints', async () => {
    await insertOrder('V3T-H1');
    const detail = await get('/api/orders/V3T-H1?dept=knitting');
    expect(detail.status).toBe(200);

    const res = await post('/api/orders/save-plans', {
      orderNo: 'V3T-H1',
      plans: [
        { department: 'knitting', fabricItems: planRows('V3T-H1', 'knitting', 2, 'Confirm'), orderStatus: 'On Process' },
        { department: 'dyeing', fabricItems: planRows('V3T-H1', 'dyeing', 2, 'Tentative'), orderStatus: 'On Process' },
      ],
      base: { knitting: detail.body.fingerprints.knitting, dyeing: detail.body.fingerprints.dyeing },
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['message', 'planData', 'planStatuses', 'statusSynced', 'fingerprints']);
    expect(res.body.message).toBe('Planning Data saved successfully!');
    expect(res.body.planData.orderNo).toBe('V3T-H1');
    expect(res.body.planData.knitting).toEqual(planRows('V3T-H1', 'knitting', 2, 'Confirm'));
    expect(res.body.planStatuses).toEqual({ knitting: 'Confirm', dyeing: 'Tentative' });
    expect(res.body.statusSynced).toBe(true);
    expect(Object.keys(res.body.fingerprints)).toEqual([...PLAN_DEPTS]);

    const after = await get('/api/orders/V3T-H1?dept=dyeing&fresh=1');
    expect(after.body.fingerprints).toEqual(res.body.fingerprints);
    expect(after.body.order.knittingPlanStatus).toBe('Confirm');
  });

  it('answers 400 {code: INVALID, message}', async () => {
    await insertOrder('V3T-H2');
    const res = await post('/api/orders/save-plans', { orderNo: 'V3T-H2', plans: [{ department: 'knitting', fabricItems: [] }] });
    expect(res).toEqual({ status: 400, body: { code: 'INVALID', message: 'plans.0.fabricItems: At least one item is required.' } });
    const empty = await post('/api/orders/save-plans', undefined);
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('INVALID');
  });

  it('answers 404 {message} for an unknown order', async () => {
    const res = await post('/api/orders/save-plans', { orderNo: 'V3T-NOPE', plans: [{ department: 'yd', fabricItems: [{ itemId: 'a' }] }] });
    expect(res).toEqual({ status: 404, body: { message: 'Order "V3T-NOPE" not found.' } });
  });

  it('answers 409 {code: CONFLICT, message, departments}', async () => {
    await insertOrder('V3T-H3');
    const detail = await get('/api/orders/V3T-H3');
    await post('/api/orders/save-dates', { orderNo: 'V3T-H3', department: 'delivery', fabricItems: planRows('V3T-H3', 'delivery', 1), orderStatus: 'On Process' });
    const res = await post('/api/orders/save-plans', {
      orderNo: 'V3T-H3',
      plans: [{ department: 'delivery', fabricItems: planRows('V3T-H3', 'delivery', 2, 'Tentative') }],
      base: { delivery: detail.body.fingerprints.delivery },
    });
    expect(res).toEqual({
      status: 409,
      body: { code: 'CONFLICT', message: 'Delivery was changed by someone else after this order was opened.', departments: ['delivery'] },
    });
    // "Save mine anyway": the same request without base.
    const anyway = await post('/api/orders/save-plans', {
      orderNo: 'V3T-H3',
      plans: [{ department: 'delivery', fabricItems: planRows('V3T-H3', 'delivery', 2, 'Tentative') }],
    });
    expect(anyway.status).toBe(200);
    expect(anyway.body.planData.delivery).toHaveLength(2);
  });

  it('answers 500 {message} on an unexpected error', async () => {
    await insertOrder('V3T-H4');
    const exists = vi.spyOn(Order, 'exists').mockRejectedValueOnce(new Error('simulated database failure'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await post('/api/orders/save-plans', { orderNo: 'V3T-H4', plans: [{ department: 'yd', fabricItems: [{ itemId: 'a' }] }] });
    expect(res).toEqual({ status: 500, body: { message: 'Server error while saving planning data.' } });
    expect(errors).toHaveBeenCalled();
    exists.mockRestore();
    errors.mockRestore();
  });

  it('needs a login (401), but no role or menu permission (as save-dates)', async () => {
    await insertOrder('V3T-H5');
    const body = { orderNo: 'V3T-H5', plans: [{ department: 'knitting', fabricItems: planRows('V3T-H5', 'knitting', 1) }] };
    expect((await post('/api/orders/save-plans', body, 'not-a-token')).status).toBe(401);
    expect((await post('/api/orders/save-plans', body, viewerToken)).status).toBe(200);
  });
});

describe('GET /api/orders/:orderNo', () => {
  it('adds fingerprints and deptFlags', async () => {
    await insertOrder('V3T-H6', { knitting: 1, dyeing: 1 });
    await rawCollection('deptvalidorders').insertOne({ dept: 'dyeing', validOrderNos: ['V3T-SOMETHING-ELSE'] });
    const res = await get('/api/orders/V3T-H6?dept=knitting');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['order', 'planData', 'fingerprints', 'deptFlags']);
    expect(res.body.planData).toBeNull();
    expect(res.body.fingerprints).toEqual(Object.fromEntries(PLAN_DEPTS.map((d) => [d, UNSAVED_FINGERPRINT])));
    expect(res.body.deptFlags.dyeing).toEqual({ inLatestFile: false, hasItems: true });
    expect(res.body.deptFlags.knitting).toEqual({ inLatestFile: true, hasItems: true });
    expect(res.body.deptFlags.delivery).toEqual({ inLatestFile: true, hasItems: false });
  });

  it('?fresh=1 skips the 60 s cache; other values do not', async () => {
    await insertOrder('V3T-H7', { knitting: 1 });
    expect((await get('/api/orders/V3T-H7?dept=knitting')).body.planData).toBeNull();
    await rawCollection('orderdates').insertOne({ orderNo: 'V3T-H7', knitting: planRows('V3T-H7', 'knitting', 1), knittingStatus: 'Confirm' });

    expect((await get('/api/orders/V3T-H7?dept=knitting')).body.planData).toBeNull();
    expect((await get('/api/orders/V3T-H7?dept=knitting&fresh=0')).body.planData).toBeNull();
    const fresh = await get('/api/orders/V3T-H7?dept=knitting&fresh=1');
    expect(fresh.body.planData.knittingStatus).toBe('Confirm');
    expect((await get('/api/orders/V3T-H7?dept=knitting')).body.planData.knittingStatus).toBe('Confirm');
  });

  it('keeps answering 404 {message} for an unknown order', async () => {
    expect(await get('/api/orders/V3T-NOPE?fresh=1')).toEqual({ status: 404, body: { message: 'Order "V3T-NOPE" not found.' } });
  });
});

describe('POST /api/orders/save-dates is unchanged', () => {
  it('still answers {message, data} and writes one department', async () => {
    await insertOrder('V3T-H8');
    const res = await post('/api/orders/save-dates', {
      orderNo: 'V3T-H8',
      department: 'knitting',
      fabricItems: planRows('V3T-H8', 'knitting', 1, 'Tentative'),
      orderStatus: 'On Process',
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['message', 'data']);
    expect(res.body.data.knitting).toEqual(planRows('V3T-H8', 'knitting', 1, 'Tentative'));
    expect((await Order.findOne({ orderNo: 'V3T-H8' }).lean())!.knittingPlanStatus).toBe('Tentative');
  });
});
