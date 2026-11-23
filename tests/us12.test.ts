import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import app from '../src/app.js';
import { DeptValidOrders } from '../src/models/DeptValidOrders.model.js';
import { Order } from '../src/models/Order.model.js';
import { OrderDate } from '../src/models/OrderDate.model.js';
import { User } from '../src/models/User.model.js';
import { OrderService } from '../src/services/order.service.js';
import { ReportExportService } from '../src/services/report-export.service.js';
import { createTestUser, requestJson, startApp, type RunningApp } from './helpers/http.js';
import { clearCollections, closeTestDb, openTestDb } from './helpers/local-mongo.js';
import { insertOrder, planRows } from './helpers/plan-data.js';

vi.mock('../src/config/env.js', () => import('./helpers/test-env.js'));

/** US-12: the new Knitting / Dyeing report columns, the Delivery Floor / Lock reports and the PPI Style search. */

const DB = 'v3t_s12_us12';
let running: RunningApp;
let token = '';

const get = (path: string) => requestJson(running.baseUrl, 'GET', path, token);

beforeAll(async () => {
  await openTestDb(DB, [Order, OrderDate, User, DeptValidOrders]);
  running = await startApp(app);
  token = await createTestUser('Admin', 'v3t_us12_admin');
});

afterAll(async () => {
  if (running) await running.close();
  await closeTestDb();
});

beforeEach(async () => {
  await clearCollections(['orders', 'orderdates', 'deptvalidorders']);
  OrderService.clearReportCache();
});

/** The sheet of a report as rows of displayed text (header row first). */
function sheetRows(buffer: Buffer | null): string[][] {
  expect(buffer).not.toBeNull();
  const wb = XLSX.read(buffer as Buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
}

const col = (rows: string[][], name: string) => rows[0].indexOf(name);
const cell = (rows: string[][], r: number, name: string) => rows[r][col(rows, name)];

describe('Knitting / Dyeing report columns', () => {
  it('Knitting: Yarn Date (row yarnDate) and Actual Yarn Date (planExtras) right after Plan Type', async () => {
    await insertOrder('V3T-K1', { knitting: 2 });
    await Order.updateOne({ orderNo: 'V3T-K1' }, { $set: { knittingPlanStatus: 'Confirm' } });
    const rows = planRows('V3T-K1', 'knitting', 2, 'Confirm', { yarnDate: '2026-11-20' });
    await OrderDate.create({
      orderNo: 'V3T-K1',
      knitting: rows,
      planExtras: { knitting: { [rows[0].itemId]: { actualYarnDate: '2026-11-22' } } },
    });

    const sheet = sheetRows(await ReportExportService.generateDepartmentReport('knitting'));
    const planType = col(sheet, 'Plan Type');
    expect(planType).toBeGreaterThanOrEqual(0);
    expect(sheet[0].slice(planType, planType + 3)).toEqual(['Plan Type', 'Yarn Date', 'Actual Yarn Date']);
    expect(sheet.length).toBe(3);
    // Same date format as the other date columns (dd/mm/yyyy)
    expect(cell(sheet, 1, 'Plan End Date')).toBe('15/12/2026');
    expect(cell(sheet, 1, 'Yarn Date')).toBe('20/11/2026');
    expect(cell(sheet, 1, 'Actual Yarn Date')).toBe('22/11/2026');
    expect(cell(sheet, 2, 'Actual Yarn Date')).toBe('');

    // Pending download keeps the same columns
    await Order.updateOne({ orderNo: 'V3T-K1' }, { $set: { knittingPlanStatus: 'Pending' } });
    const pending = sheetRows(await ReportExportService.generateDepartmentReport('knitting', undefined, { pendingOnly: true }));
    expect(pending[0].slice(col(pending, 'Plan Type'), col(pending, 'Plan Type') + 3)).toEqual([
      'Plan Type',
      'Yarn Date',
      'Actual Yarn Date',
    ]);
  });

  it('Dyeing: LD Plan Date and Actual LD Date (planExtras) right after Plan Type', async () => {
    await insertOrder('V3T-Y1', { dyeing: 2 });
    await Order.updateOne({ orderNo: 'V3T-Y1' }, { $set: { dyeingPlanStatus: 'Tentative' } });
    const rows = planRows('V3T-Y1', 'dyeing', 2, 'Tentative');
    await OrderDate.create({
      orderNo: 'V3T-Y1',
      dyeing: rows,
      planExtras: { dyeing: { [rows[1].itemId]: { ldPlanDate: '2026-12-02', actualLdDate: '2026-12-04' } } },
    });

    const sheet = sheetRows(await ReportExportService.generateDepartmentReport('dyeing'));
    const planType = col(sheet, 'Plan Type');
    expect(sheet[0].slice(planType, planType + 3)).toEqual(['Plan Type', 'LD Plan Date', 'Actual LD Date']);
    expect(cell(sheet, 1, 'LD Plan Date')).toBe('');
    expect(cell(sheet, 2, 'LD Plan Date')).toBe('02/12/2026');
    expect(cell(sheet, 2, 'Actual LD Date')).toBe('04/12/2026');
  });
});

describe('Delivery Plan (Floor) / (Lock) reports', () => {
  // D1: Lock Confirm, Floor Tentative. D2: Lock blank (Pending), Floor Confirm. D3: no plan (Pending). D4: Completed.
  async function seedDelivery() {
    for (const no of ['V3T-D1', 'V3T-D2', 'V3T-D3', 'V3T-D4']) {
      await insertOrder(no, { delivery: 1 });
      await Order.updateOne({ orderNo: no }, { $set: { deliveryPlanStatus: 'Pending' } });
    }
    await OrderDate.create({
      orderNo: 'V3T-D1',
      delivery: planRows('V3T-D1', 'delivery', 1, 'Confirm', { limitation: 'L1', remarks: 'R1' }),
    });
    await OrderDate.create({
      orderNo: 'V3T-D2',
      delivery: planRows('V3T-D2', 'delivery', 1, '', { floorPlanType: 'Confirm' }),
    });
    await OrderDate.create({
      orderNo: 'V3T-D4',
      deliveryStatus: 'Completed',
      delivery: planRows('V3T-D4', 'delivery', 1, 'Confirm'),
    });
  }

  const orderNos = (sheet: string[][]) => sheet.slice(1).map((r) => r[col(sheet, 'OrderNo')]).sort();

  it('Floor: Floor plan columns only; orders by the computed Floor status', async () => {
    await seedDelivery();
    const sheet = sheetRows(await ReportExportService.generateDepartmentReport('deliveryfloor'));
    expect(sheet[0]).toEqual(expect.arrayContaining(['Delivery Plan Start (Floor)', 'Delivery Plan End (Floor)', 'Delivery Plan Type (Floor)']));
    for (const lockCol of ['Delivery Plan Start', 'Delivery Plan End', 'Delivery Plan Type', 'Limitation', 'Remarks']) {
      expect(sheet[0]).not.toContain(lockCol);
    }
    expect(orderNos(sheet)).toEqual(['V3T-D1', 'V3T-D2', 'V3T-D3']);
    const d1 = sheet.findIndex((r) => r[col(sheet, 'OrderNo')] === 'V3T-D1');
    expect(cell(sheet, d1, 'Delivery Plan Start (Floor)')).toBe('03/12/2026');
    expect(cell(sheet, d1, 'Delivery Plan Type (Floor)')).toBe('Tentative');

    const pending = sheetRows(await ReportExportService.generateDepartmentReport('deliveryfloor', undefined, { pendingOnly: true }));
    expect(orderNos(pending)).toEqual(['V3T-D3']);
  });

  it('Lock: Lock plan columns only; orders by the computed Lock status', async () => {
    await seedDelivery();
    const sheet = sheetRows(await ReportExportService.generateDepartmentReport('deliverylock'));
    const start = col(sheet, 'Delivery Plan Start');
    expect(sheet[0].slice(start, start + 5)).toEqual([
      'Delivery Plan Start',
      'Delivery Plan End',
      'Delivery Plan Type',
      'Limitation',
      'Remarks',
    ]);
    expect(sheet[0].some((h) => h.includes('(Floor)'))).toBe(false);
    expect(orderNos(sheet)).toEqual(['V3T-D1', 'V3T-D2', 'V3T-D3']);
    const d1 = sheet.findIndex((r) => r[col(sheet, 'OrderNo')] === 'V3T-D1');
    expect(cell(sheet, d1, 'Delivery Plan Type')).toBe('Confirm');
    expect(cell(sheet, d1, 'Limitation')).toBe('L1');

    const pending = sheetRows(await ReportExportService.generateDepartmentReport('deliverylock', undefined, { pendingOnly: true }));
    expect(orderNos(pending)).toEqual(['V3T-D2', 'V3T-D3']);
  });

  it('the combined Delivery report keeps both column sets in the old order', async () => {
    await seedDelivery();
    const sheet = sheetRows(await ReportExportService.generateDepartmentReport('delivery'));
    const start = col(sheet, 'Delivery Plan Start');
    expect(sheet[0].slice(start)).toEqual([
      'Delivery Plan Start',
      'Delivery Plan End',
      'Delivery Plan Type',
      'Delivery Plan Start (Floor)',
      'Delivery Plan End (Floor)',
      'Delivery Plan Type (Floor)',
      'Limitation',
      'Remarks',
    ]);
  });

  it('HTTP: report data carries <dept>PlanStatus, downloads answer for both, unknown depts are refused', async () => {
    await seedDelivery();
    const floor = await get('/api/orders/report/deliveryfloor');
    expect(floor.status).toBe(200);
    const statuses = Object.fromEntries(floor.body.orders.map((o: any) => [o.orderNo, o.deliveryfloorPlanStatus]));
    expect(statuses).toEqual({ 'V3T-D1': 'Tentative', 'V3T-D2': 'Confirm', 'V3T-D3': 'Pending' });
    expect(Object.keys(floor.body.planMap).sort()).toEqual(['V3T-D1', 'V3T-D2']);

    const lockPending = await get('/api/orders/report/deliverylock?pendingOnly=true');
    expect(lockPending.body.orders.map((o: any) => o.orderNo)).toEqual(['V3T-D3', 'V3T-D2']);
    expect(lockPending.body.orders.every((o: any) => o.deliverylockPlanStatus === 'Pending')).toBe(true);

    for (const path of [
      '/api/orders/report-download/deliveryfloor',
      '/api/orders/report-download/deliverylock',
      '/api/orders/pending-download/deliveryfloor',
      '/api/orders/pending-download/deliverylock',
    ]) {
      expect((await get(path)).status).toBe(200);
    }
    expect((await get('/api/orders/report-download/deliveryxyz')).status).toBe(400);
  });
});

describe('PPI: Style on /api/orders/all-list and the style search', () => {
  it('each order carries style; style= is a case-insensitive contains match; search= is unchanged', async () => {
    await insertOrder('V3T-P1', { knitting: 1 });
    await insertOrder('V3T-P2', { knitting: 1 });
    await insertOrder('V3T-P3', { knitting: 1 });
    await Order.updateOne({ orderNo: 'V3T-P1' }, { $set: { style: 'Basic Polo (Navy)' } });
    await Order.updateOne({ orderNo: 'V3T-P2' }, { $set: { style: 'KIDS POLO' } });
    await Order.updateOne({ orderNo: 'V3T-P3' }, { $set: { style: 'Tee' } });

    const all = await get('/api/orders/all-list?limit=50');
    expect(all.status).toBe(200);
    expect(Object.fromEntries(all.body.orders.map((o: any) => [o.orderNo, o.style]))).toEqual({
      'V3T-P1': 'Basic Polo (Navy)',
      'V3T-P2': 'KIDS POLO',
      'V3T-P3': 'Tee',
    });

    const polo = await get('/api/orders/all-list?style=polo');
    expect(polo.body.orders.map((o: any) => o.orderNo)).toEqual(['V3T-P2', 'V3T-P1']);
    expect(polo.body.total).toBe(2);

    // Regex characters are matched literally
    const paren = await get(`/api/orders/all-list?style=${encodeURIComponent('(navy)')}`);
    expect(paren.body.orders.map((o: any) => o.orderNo)).toEqual(['V3T-P1']);

    // search= (order no. / buyer) still works, and combines with style=
    const byNo = await get('/api/orders/all-list?search=p3');
    expect(byNo.body.orders.map((o: any) => o.orderNo)).toEqual(['V3T-P3']);
    const both = await get('/api/orders/all-list?search=p2&style=polo');
    expect(both.body.orders.map((o: any) => o.orderNo)).toEqual(['V3T-P2']);
  });
});
