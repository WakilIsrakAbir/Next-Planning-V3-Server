import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { DeptValidOrders } from '../src/models/DeptValidOrders.model.js';
import { Order } from '../src/models/Order.model.js';
import { OrderDate } from '../src/models/OrderDate.model.js';
import { OrderPlanGuide } from '../src/models/OrderPlanGuide.model.js';
import { PlanningSetting } from '../src/models/PlanningSetting.model.js';
import { User } from '../src/models/User.model.js';
import { OrderService } from '../src/services/order.service.js';
import { computeGuideDefaults } from '../src/utils/plan-guide-dates.js';
import { createTestUser, requestJson, startApp, type RunningApp } from './helpers/http.js';
import { clearCollections, closeTestDb, openTestDb, rawCollection } from './helpers/local-mongo.js';

// The app's env module would read the server's .env (live database URI); tests use a stand-in.
vi.mock('../src/config/env.js', () => import('./helpers/test-env.js'));

/** PUT /api/orders/:orderNo/plan-guide and the guide in GET /api/orders/:orderNo, through the Express app. */

const DB = 'v3t_plan_guide_http';
let running: RunningApp;
let viewerToken = '';
let adminToken = '';

const TNA = { yarnDate: '2026-09-28', knitStart: '2026-10-02', knitEnd: '2026-10-21', dyeStart: '2026-10-15', dyeEnd: '2026-10-30', deliStart: '2026-11-02', deliEnd: '2026-11-12' };
const DATES = computeGuideDefaults(TNA, { startDays: 10, endDays: 7 });
const path = (orderNo: string) => `/api/orders/${encodeURIComponent(orderNo)}/plan-guide`;
const put = (orderNo: string, body: unknown, token = viewerToken) => requestJson(running.baseUrl, 'PUT', path(orderNo), token, body);
const get = (orderNo: string, query = '') => requestJson(running.baseUrl, 'GET', `/api/orders/${encodeURIComponent(orderNo)}${query}`, viewerToken);

beforeAll(async () => {
  await openTestDb(DB, [Order, OrderDate, OrderPlanGuide, PlanningSetting, User, DeptValidOrders]);
  running = await startApp(app);
  viewerToken = await createTestUser('Viewer', 'v3t_guide_viewer');
  adminToken = await createTestUser('Admin', 'v3t_guide_admin');
});

afterAll(async () => {
  if (running) await running.close();
  await closeTestDb();
});

beforeEach(async () => {
  await clearCollections(['orders', 'orderdates', 'orderplanguides', 'planningsettings', 'deptvalidorders']);
  OrderService.clearReportCache();
  await Order.create({ orderNo: 'V3T-HG1', buyer: 'V3T BUYER', ...TNA });
});

describe('PUT /api/orders/:orderNo/plan-guide', () => {
  it('needs a login (401) but no role or menu permission: a Viewer may save', async () => {
    expect((await put('V3T-HG1', { yesIds: [], dates: DATES }, 'not-a-token')).status).toBe(401);
    const res = await put('V3T-HG1', { yesIds: ['heatset'], dates: DATES });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      _id: 'V3T-HG1',
      orderNo: 'V3T-HG1',
      yesIds: ['heatset'],
      dates: DATES,
      lead: { startDays: 10, endDays: 7, startFrom: ['Heatset'], endFrom: ['Heatset'], startFromIds: ['heatset'], endFromIds: ['heatset'] },
      tna: TNA,
      checklistVersion: 1,
      version: 1,
      updatedBy: 'v3t_guide_viewer',
    });
    expect(res.body.checks).toHaveLength(9);
    expect(typeof res.body.updatedAt).toBe('string');
  });

  it('answers 200 with the saved guide on later saves', async () => {
    await put('V3T-HG1', { yesIds: ['heatset'], dates: DATES });
    const res = await put('V3T-HG1', { yesIds: ['heatset', 'cpb'], dates: { ...DATES, lockStart: '2026-11-20' }, version: 1 }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, updatedBy: 'v3t_guide_admin', lead: { startDays: 12, endDays: 9 } });
    expect(res.body.dates.lockStart).toBe('2026-11-20');
  });

  it('answers 400 {code: INVALID, message}', async () => {
    expect(await put('V3T-HG1', { yesIds: [], dates: { ...DATES, knitStart: '2026-02-30' } })).toEqual({
      status: 400,
      body: { code: 'INVALID', message: 'dates.knitStart: must be empty or a date (YYYY-MM-DD).' },
    });
    expect(await put('V3T-HG1', { yesIds: ['heatset', 'heatset'], dates: DATES })).toEqual({
      status: 400,
      body: { code: 'INVALID', message: 'Checkpoint "Heatset" is set to Yes more than once.' },
    });
  });

  it('answers 404 {message} for an unknown order', async () => {
    expect(await put('V3T-NOPE', { yesIds: [], dates: DATES })).toEqual({ status: 404, body: { message: 'Order "V3T-NOPE" not found.' } });
  });

  it('answers 409 {code: CONFLICT, message} for an old version', async () => {
    await put('V3T-HG1', { yesIds: [], dates: DATES });
    await put('V3T-HG1', { yesIds: ['cpb'], dates: DATES, version: 1 }, adminToken);
    const res = await put('V3T-HG1', { yesIds: ['heatset'], dates: DATES, version: 1 });
    expect(res.status).toBe(409);
    expect(Object.keys(res.body)).toEqual(['code', 'message']);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toMatch(
      /^The Planning Guide of this order was changed by v3t_guide_admin at \d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}\. Reload the page to see the latest values\.$/
    );
  });

  it('answers 500 {message} on an unexpected error', async () => {
    const find = vi.spyOn(Order, 'findOne').mockImplementationOnce(() => {
      throw new Error('simulated database failure');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await put('V3T-HG1', { yesIds: [], dates: DATES })).toEqual({
      status: 500,
      body: { message: 'Server error while saving the Planning Guide.' },
    });
    find.mockRestore();
    errors.mockRestore();
  });

  it('works for an order number that needs URL encoding', async () => {
    await Order.create({ orderNo: 'V3T/HG 2', buyer: 'V3T BUYER', ...TNA });
    const res = await put('V3T/HG 2', { yesIds: [], dates: DATES });
    expect(res.status).toBe(200);
    expect(res.body._id).toBe('V3T/HG 2');
    expect((await get('V3T/HG 2')).body.guide.version).toBe(1);
  });
});

describe('GET /api/orders/:orderNo: guide', () => {
  it('is null before the first save; a save clears the cached details, so the next read has it', async () => {
    const before = await get('V3T-HG1', '?dept=knitting');
    expect(before.status).toBe(200);
    expect(Object.keys(before.body)).toEqual(['order', 'planData', 'fingerprints', 'deptFlags', 'guide']);
    expect(before.body.guide).toBeNull();

    const saved = await put('V3T-HG1', { yesIds: ['heatset'], dates: DATES });
    const after = await get('V3T-HG1', '?dept=knitting');
    expect(after.body.guide).toEqual(saved.body);
    expect((await get('V3T-HG1', '?dept=dyeing&fresh=1')).body.guide).toEqual(saved.body);
    expect(await rawCollection('orderplanguides').countDocuments({})).toBe(1);
  });
});
