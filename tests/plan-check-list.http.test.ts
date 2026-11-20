import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { OrderPlanGuide } from '../src/models/OrderPlanGuide.model.js';
import { PlanningSetting } from '../src/models/PlanningSetting.model.js';
import { User } from '../src/models/User.model.js';
import { PLAN_CHECK_LIST_DEFAULTS } from '../src/constants/plan-check-list-defaults.js';
import { createTestUser, requestJson, startApp, type RunningApp } from './helpers/http.js';
import { clearCollections, closeTestDb, openTestDb, rawCollection } from './helpers/local-mongo.js';

// The app's env module would read the server's .env (live database URI); tests use a stand-in.
vi.mock('../src/config/env.js', () => import('./helpers/test-env.js'));

/** The HTTP routes GET and PUT /api/plan-check-list, through the Express app. */

const DB = 'v3t_plan_check_list_http';
let running: RunningApp;
const tokens: Record<string, string> = {};

const get = (auth: string) => requestJson(running.baseUrl, 'GET', '/api/plan-check-list', auth);
const put = (auth: string, body: unknown) => requestJson(running.baseUrl, 'PUT', '/api/plan-check-list', auth, body);

beforeAll(async () => {
  await openTestDb(DB, [PlanningSetting, OrderPlanGuide, User]);
  running = await startApp(app);
  tokens.admin = await createTestUser('Admin', 'v3t_pcl_admin');
  tokens.viewer = await createTestUser('Viewer', 'v3t_pcl_viewer');
  tokens.approver = await createTestUser('Approver', 'v3t_pcl_approver', { menus: { dataManagement: { setup: true, atlasMonitor: true } } });
  tokens.editor = await createTestUser('Planner', 'v3t_pcl_editor', { menus: { dataManagement: { planCheckList: true } } });
  tokens.textTrue = await createTestUser('Planner', 'v3t_pcl_text', { menus: { dataManagement: { planCheckList: 'true' } } });
});

afterAll(async () => {
  if (running) await running.close();
  await closeTestDb();
});

beforeEach(async () => {
  await clearCollections(['planningsettings', 'orderplanguides']);
});

describe('GET /api/plan-check-list', () => {
  it('needs a login (401)', async () => {
    expect((await get('not-a-token')).status).toBe(401);
  });

  it('answers 200 for every signed-in user, never 403, with Cache-Control: no-store', async () => {
    for (const who of ['viewer', 'approver', 'textTrue', 'editor', 'admin']) {
      const res = await fetch(`${running.baseUrl}/api/plan-check-list`, { headers: { Authorization: `Bearer ${tokens[who]}` } });
      expect(res.status, who).toBe(200);
      expect(res.headers.get('cache-control'), who).toBe('no-store');
      const body = await res.json();
      expect(body.items, who).toEqual(PLAN_CHECK_LIST_DEFAULTS);
      expect(body.defaults, who).toEqual(PLAN_CHECK_LIST_DEFAULTS);
      expect(body.version, who).toBe(1);
      expect(body.updatedBy, who).toBe('system');
    }
    expect(await rawCollection('planningsettings').countDocuments({})).toBe(1);
  });

  it('says who may edit, and sends usage only to them', async () => {
    await rawCollection('orderplanguides').insertOne({ _id: 'V3T-1', orderNo: 'V3T-1', yesIds: ['cpb'] } as any);
    const viewer = await get(tokens.viewer);
    expect(viewer.body.canEdit).toBe(false);
    expect('usage' in viewer.body).toBe(false);
    expect((await get(tokens.textTrue)).body.canEdit).toBe(false);
    expect((await get(tokens.approver)).body.canEdit).toBe(false);

    const admin = await get(tokens.admin);
    expect(Object.keys(admin.body)).toEqual(['items', 'version', 'updatedBy', 'updatedAt', 'defaults', 'canEdit', 'usage']);
    expect(admin.body.canEdit).toBe(true);
    expect(admin.body.usage.cpb).toBe(1);
    expect(admin.body.usage.heatset).toBe(0);
    expect((await get(tokens.editor)).body.canEdit).toBe(true);
  });

  it('answers 500 {message} when the database fails', async () => {
    const find = vi.spyOn(PlanningSetting, 'findById').mockImplementationOnce(() => {
      throw new Error('simulated database failure');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await get(tokens.viewer);
    expect(res).toEqual({ status: 500, body: { message: 'Could not load the Plan Check List.' } });
    find.mockRestore();
    errors.mockRestore();
  });
});

describe('PUT /api/plan-check-list', () => {
  const items = PLAN_CHECK_LIST_DEFAULTS.map((item) => ({ ...item }));

  it('needs a login (401)', async () => {
    expect((await put('not-a-token', { items, version: 1 })).status).toBe(401);
  });

  it('answers 403 {code: PERMISSION} without the permission (Approver is not Admin; the key must be exactly true)', async () => {
    await get(tokens.admin);
    for (const who of ['viewer', 'approver', 'textTrue']) {
      const res = await put(tokens[who], { items, version: 1 });
      expect(res, who).toEqual({
        status: 403,
        body: { code: 'PERMISSION', message: 'Access forbidden: Plan Check List permission required.' },
      });
    }
    expect((await rawCollection('planningsettings').findOne({}))!.version).toBe(1);
  });

  it('saves for Admin and for users with the permission, answering the saved list', async () => {
    await get(tokens.viewer);
    const first = await put(tokens.editor, { items: [{ ...items[0], name: 'Heatset (HT)' }, ...items.slice(1)], version: 1 });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);
    expect(first.body.updatedBy).toBe('v3t_pcl_editor');
    expect(first.body.items[0]).toEqual({ id: 'heatset', name: 'Heatset (HT)', startDays: 10, endDays: 7, active: true });
    expect(first.body.canEdit).toBe(true);
    expect(first.body.usage).toBeDefined();

    const second = await put(tokens.admin, { items: first.body.items.slice(0, 2), version: 2 });
    expect(second.status).toBe(200);
    expect(second.body.version).toBe(3);
    expect((await get(tokens.viewer)).body.items).toHaveLength(2);
  });

  it('answers 400 {code: INVALID, message} naming the row', async () => {
    await get(tokens.admin);
    const bad = items.map((item) => (item.id === 'cpb' ? { ...item, startDays: 12.5 } : item));
    expect(await put(tokens.admin, { items: bad, version: 1 })).toEqual({
      status: 400,
      body: { code: 'INVALID', message: 'Row 3 (CPB): Start days must be a whole number from 0 to 365.' },
    });
  });

  it('answers 409 {code: CONFLICT, message} to a save of an old version', async () => {
    await get(tokens.admin);
    expect((await put(tokens.editor, { items, version: 1 })).status).toBe(200);
    const res = await put(tokens.admin, { items: items.slice(0, 1), version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toMatch(
      /^The Plan Check List was changed by v3t_pcl_editor at \d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}\. Reload the page to see the latest values\.$/
    );
    expect((await get(tokens.viewer)).body.items).toHaveLength(items.length);
  });
});
