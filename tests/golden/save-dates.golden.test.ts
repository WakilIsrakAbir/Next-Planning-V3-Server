import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { Order } from '../../src/models/Order.model.js';
import { OrderDate } from '../../src/models/OrderDate.model.js';
import { User } from '../../src/models/User.model.js';
import { OrderService } from '../../src/services/order.service.js';
import { StatusEngineService } from '../../src/services/status-engine.service.js';
import { createTestUser, requestJson, startApp, type RunningApp } from '../helpers/http.js';
import { closeTestDb, openTestDb, rawCollection } from '../helpers/local-mongo.js';
import {
  goldenFile,
  loadGoldenFixtures,
  readGolden,
  seedGoldenOrders,
  writeGolden,
  type GoldenFixtures,
  type GoldenOrder,
} from './golden-fixtures.js';

// The app's env module would read the server's .env (live database URI); tests use a stand-in.
vi.mock('../../src/config/env.js', () => import('../helpers/test-env.js'));

/**
 * GOLDEN MASTER for save-dates.
 *
 * Runs OrderService.savePlanningDates (the POST /api/orders/save-dates and /api/files/save-dates handler's service)
 * and StatusEngineService.recalcSingleOrder through scripted saves on 13 real orders copied from abir_test, across
 * every department, plus the edge cases the code allows today. After each step it records the returned value, any
 * warning, and the stored OrderDate and Order documents (timestamps stripped; the Order without its Excel item
 * arrays, which save-dates never writes, plus a hash proving they did not change).
 *
 * The recording was made on the unmodified code before the save-plans work (S1). It holds real data, so it stays in
 * tests/golden/local (gitignored). GOLDEN_RECORD=1 re-records; otherwise any difference fails.
 */

const { EJSON } = mongoose.mongo.BSON;
const DB = 'v3t_golden_save_dates';
const RECORDING = goldenFile('save-dates.golden.json');
const RAW = { promoteValues: false, promoteLongs: false } as const;
const ITEM_ARRAYS = ['ydItems', 'knittingItems', 'dyeingItems', 'finishingItems', 'deliveryItems'];
const NO_ORDER = 'V3T-GOLDEN-NO-ORDER';
const NO_ORDER_2 = 'V3T-GOLDEN-NO-ORDER-2';

interface StepCall {
  orderNo: string;
  department: string;
  fabricItems?: unknown;
  orderStatus?: string;
  completedDate?: string;
  actualData?: Record<string, unknown>;
}

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
/** What the server receives from a browser: plain JSON. */
const wire = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function without(doc: Record<string, any> | null, keys: string[]): Record<string, any> | null {
  if (!doc) return null;
  const copy: Record<string, any> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!keys.includes(key)) copy[key] = value;
  }
  return copy;
}

const STAMPS = ['_id', 'createdAt', 'updatedAt'];

async function snapshot(orderNo: string, fixtureOrderDateId: string | null) {
  const orderDates = await rawCollection('orderdates').find({ orderNo }, RAW).toArray();
  const orders = await rawCollection('orders').find({ orderNo }, RAW).toArray();
  const od = orderDates[0] || null;
  const order = orders[0] || null;
  return {
    orderDates: {
      count: orderDates.length,
      keptFixtureId: fixtureOrderDateId && od ? String(od._id) === fixtureOrderDateId : null,
      doc: od ? EJSON.serialize(without(od, STAMPS), { relaxed: false }) : null,
    },
    order: {
      count: orders.length,
      doc: order ? EJSON.serialize(without(order, [...STAMPS, ...ITEM_ARRAYS]), { relaxed: false }) : null,
      itemArraysSha1: order ? sha1(EJSON.stringify(ITEM_ARRAYS.map((k) => (order as any)[k] ?? null), { relaxed: false })) : null,
    },
  };
}

function fixtureDoc(doc: Record<string, unknown> | null): any {
  return doc ? EJSON.deserialize(doc, { relaxed: true }) : null;
}

/** The rows a save sends for a department: the saved rows, else rows built from the order's Excel items. */
function baseItems(fx: GoldenOrder, dept: string): any[] {
  const od = fixtureDoc(fx.orderDate);
  const order = fixtureDoc(fx.order);
  if (Array.isArray(od?.[dept]) && od[dept].length) return wire(od[dept]);
  if (dept === 'finishing') {
    const dyeing = Array.isArray(od?.dyeing) && od.dyeing.length ? od.dyeing : (order?.dyeingItems || []).map((raw: any) => ({ itemData: raw }));
    return wire(dyeing.map((it: any, i: number) => ({ ...it, itemId: `finishing_${it.itemId ?? i}`, planType: '' })));
  }
  const raw: any[] = Array.isArray(order?.[`${dept}Items`]) ? order[`${dept}Items`] : [];
  const rows = raw.length ? raw : [{}];
  return wire(
    rows.map((row, i) => ({
      itemId: `${fx.orderNo}_${dept}_${i}`,
      itemData: row,
      planType: '',
      startDate: '',
      endDate: '',
      limitation: '',
      remarks: '',
      ...(dept === 'delivery' ? { floorStartDate: '', floorEndDate: '', floorPlanType: '' } : {}),
    }))
  );
}

const PLAN_DATES = { startDate: '2026-12-01', endDate: '2026-12-10' };
const FLOOR_DATES = { floorStartDate: '2026-12-02', floorEndDate: '2026-12-09' };

function variants(orderNo: string, dept: string, items: any[], savedStatus: string | undefined): (StepCall & { name: string })[] {
  const typed = (type: unknown) =>
    items.map((it) => ({ ...it, planType: type, ...PLAN_DATES, ...(dept === 'delivery' ? { ...FLOOR_DATES, floorPlanType: type } : {}) }));
  const last = items.length - 1;
  const steps: (StepCall & { name: string })[] = [
    { name: 'resave', orderNo, department: dept, fabricItems: items, orderStatus: savedStatus },
    { name: 'confirm-all', orderNo, department: dept, fabricItems: typed('Confirm'), orderStatus: 'Confirm' },
    {
      name: 'tentative-first',
      orderNo,
      department: dept,
      fabricItems: items.map((it, i) => ({ ...it, planType: i === 0 ? 'Tentative' : 'Confirm', ...PLAN_DATES })),
      orderStatus: 'Tentative',
    },
    {
      name: 'blank-last',
      orderNo,
      department: dept,
      fabricItems: items.map((it, i) => ({ ...it, planType: i === last ? '' : 'Confirm' })),
      orderStatus: 'Pending',
    },
    {
      name: 'select-and-pending',
      orderNo,
      department: dept,
      fabricItems: items.map((it, i) => ({ ...it, planType: i % 2 ? 'Pending' : 'Select' })),
      orderStatus: 'On Process',
    },
    {
      name: 'pending-and-tentative',
      orderNo,
      department: dept,
      fabricItems: items.map((it, i) => ({ ...it, planType: i === 0 ? 'Pending' : 'Tentative' })),
      orderStatus: 'Tentative',
    },
    { name: 'pending-only', orderNo, department: dept, fabricItems: typed('Pending'), orderStatus: 'On Process' },
    {
      name: 'plantype-missing',
      orderNo,
      department: dept,
      fabricItems: items.map(({ planType: _drop, ...rest }) => rest),
      orderStatus: 'On Process',
    },
    { name: 'completed', orderNo, department: dept, fabricItems: typed('Confirm'), orderStatus: 'Completed', completedDate: '2026-11-21' },
    { name: 'completed-date-empty', orderNo, department: dept, fabricItems: typed('Confirm'), orderStatus: 'On Process', completedDate: '' },
    { name: 'status-omitted', orderNo, department: dept, fabricItems: typed('Tentative') },
    { name: 'status-empty', orderNo, department: dept, fabricItems: typed('Confirm'), orderStatus: '' },
    { name: 'items-omitted', orderNo, department: dept, orderStatus: 'On Process' },
    { name: 'items-empty', orderNo, department: dept, fabricItems: [], orderStatus: 'Pending' },
    {
      name: 'actual',
      orderNo,
      department: `${dept}Actual`,
      fabricItems: [],
      actualData: { actualStart: '2026-11-01', actualEnd: '2026-11-15', failReason: '', relatedDept: '', status: 'Complete' },
    },
    {
      name: 'actual-without-end',
      orderNo,
      department: `${dept}Actual`,
      fabricItems: [],
      actualData: { actualStart: '2026-11-02', failReason: 'Machine breakdown', relatedDept: 'knitting' },
    },
  ];
  if (dept === 'delivery') {
    steps.push(
      {
        name: 'floor-confirm-lock-blank',
        orderNo,
        department: dept,
        fabricItems: items.map((it) => ({ ...it, planType: '', floorPlanType: 'Confirm', ...FLOOR_DATES })),
        orderStatus: 'On Process',
      },
      {
        name: 'deliveryfloor-actual',
        orderNo,
        department: 'deliveryfloorActual',
        fabricItems: [],
        actualData: { actualStart: '2026-11-03', actualEnd: '2026-11-20' },
      }
    );
  }
  steps.push({ name: 'restore', orderNo, department: dept, fabricItems: items, orderStatus: savedStatus });
  return steps;
}

describe('golden: save-dates (savePlanningDates + recalcSingleOrder)', () => {
  let fixtures: GoldenFixtures | null = null;
  let running: RunningApp | null = null;
  let token = '';
  const warnings: string[] = [];

  beforeAll(async () => {
    fixtures = await loadGoldenFixtures();
    if (!fixtures) return;
    await openTestDb(DB, [Order, OrderDate, User]);
    await seedGoldenOrders(fixtures);
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    });
    running = await startApp(app);
    token = await createTestUser('Admin', 'v3t_golden_admin');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (running) await running.close();
    await closeTestDb();
  });

  it('gives exactly the recorded documents for every scripted save', async (ctx) => {
    if (!fixtures) {
      ctx.skip('No local golden fixtures and no abir_test on the local test MongoDB.');
      return;
    }
    const fx = fixtures;
    const steps: any[] = [];
    const fixtureIds = new Map<string, string>();
    for (const order of fx.orders) {
      const od = fixtureDoc(order.orderDate);
      if (od?._id) fixtureIds.set(order.orderNo, String(od._id));
    }

    const record = async (name: string, call: StepCall, run: () => Promise<unknown>) => {
      warnings.length = 0;
      let returned: unknown;
      let thrown: string | null = null;
      try {
        returned = await run();
      } catch (err: any) {
        thrown = String(err?.message ?? err);
      }
      const json = returned && typeof returned === 'object' ? without(wire(returned) as any, STAMPS) : returned ?? null;
      steps.push({
        step: `${call.orderNo}/${call.department}/${name}`,
        call: {
          department: call.department,
          orderStatus: call.orderStatus ?? null,
          completedDate: call.completedDate ?? null,
          actualData: call.actualData ?? null,
          items: Array.isArray(call.fabricItems) ? call.fabricItems.length : call.fabricItems === undefined ? 'omitted' : typeof call.fabricItems,
        },
        returned: json,
        thrown,
        warnings: [...warnings],
        ...(await snapshot(call.orderNo, fixtureIds.get(call.orderNo) ?? null)),
      });
    };

    const save = (name: string, call: StepCall) =>
      record(name, call, () =>
        OrderService.savePlanningDates({
          orderNo: call.orderNo,
          department: call.department,
          fabricItems: wire(call.fabricItems) as any,
          orderStatus: call.orderStatus,
          completedDate: call.completedDate,
          actualData: wire(call.actualData),
        })
      );

    // 1. Scripted saves on every golden order and department.
    for (const order of fx.orders) {
      const od = fixtureDoc(order.orderDate);
      for (const dept of order.departments) {
        const items = baseItems(order, dept);
        const saved = typeof od?.[`${dept}Status`] === 'string' ? od[`${dept}Status`] : undefined;
        for (const step of variants(order.orderNo, dept, items, saved)) {
          await save(step.name, step);
        }
      }
    }

    // 2. Edge cases save-dates accepts today.
    const first = fx.orders.find((o) => o.order && o.orderDate)!;
    const firstItems = baseItems(first, 'knitting');
    const knitStatus = fixtureDoc(first.orderDate)?.knittingStatus;
    await save('unknown-department', { orderNo: first.orderNo, department: 'v3tUnknown', fabricItems: firstItems, orderStatus: 'Confirm' });
    await save('null-item', { orderNo: first.orderNo, department: 'knitting', fabricItems: [null], orderStatus: 'On Process' });
    await save('items-not-an-array', { orderNo: first.orderNo, department: 'knitting', fabricItems: { not: 'an array' }, orderStatus: 'On Process' });
    await save('numeric-plantype', {
      orderNo: first.orderNo,
      department: 'knitting',
      fabricItems: firstItems.map((it) => ({ ...it, planType: 1 })),
      orderStatus: 'Confirm',
    });
    await save('restore-after-edges', { orderNo: first.orderNo, department: 'knitting', fabricItems: firstItems, orderStatus: knitStatus });
    await save('order-does-not-exist', { orderNo: NO_ORDER, department: 'knitting', fabricItems: firstItems, orderStatus: 'Tentative' });
    await save('order-does-not-exist-again', { orderNo: NO_ORDER, department: 'dyeing', fabricItems: firstItems, orderStatus: 'Confirm' });

    // 3. recalcSingleOrder on its own.
    const recalc = (name: string, call: StepCall) =>
      record(`recalc-${name}`, call, () =>
        StatusEngineService.recalcSingleOrder(call.orderNo, call.department, wire(call.fabricItems) as any, call.orderStatus)
      );
    const confirmed = firstItems.map((it) => ({ ...it, planType: 'Confirm' }));
    await recalc('confirm', { orderNo: first.orderNo, department: 'knitting', fabricItems: confirmed });
    await recalc('tentative', { orderNo: first.orderNo, department: 'knitting', fabricItems: firstItems.map((it) => ({ ...it, planType: 'Tentative' })), orderStatus: 'Tentative' });
    await recalc('completed-without-items', { orderNo: first.orderNo, department: 'yd', fabricItems: [], orderStatus: 'Completed' });
    await recalc('unknown-department', { orderNo: first.orderNo, department: 'v3tUnknown', fabricItems: confirmed, orderStatus: 'Completed' });
    await recalc('actual-department', { orderNo: first.orderNo, department: 'dyeingActual', fabricItems: [] });
    await recalc('delivery-floor-only', {
      orderNo: first.orderNo,
      department: 'delivery',
      fabricItems: firstItems.map((it) => ({ ...it, planType: '', floorPlanType: 'Confirm' })),
    });
    await recalc('items-null', { orderNo: first.orderNo, department: 'finishing', fabricItems: null });
    await recalc('order-does-not-exist', { orderNo: NO_ORDER_2, department: 'knitting', fabricItems: confirmed, orderStatus: 'Confirm' });

    // 4. The HTTP routes (the response body is part of the contract).
    const http = async (name: string, path: string, body: Record<string, unknown>, auth = true) => {
      const call: StepCall = { orderNo: String(body.orderNo), department: String(body.department) };
      await record(`http-${name}`, call, async () => {
        const res = await requestJson(running!.baseUrl, 'POST', path, auth ? token : 'not-a-token', body);
        const data = res.body?.data ? without(res.body.data, STAMPS) : res.body?.data;
        return { status: res.status, body: { ...res.body, ...(res.body?.data ? { data } : {}) } };
      });
    };
    await http('orders-save-dates', '/api/orders/save-dates', {
      orderNo: first.orderNo,
      department: 'knitting',
      fabricItems: confirmed,
      orderStatus: 'Confirm',
    });
    await http('files-save-dates-actual', '/api/files/save-dates', {
      orderNo: first.orderNo,
      department: 'dyeingActual',
      fabricItems: [],
      actualData: { actualStart: '2026-11-05', actualEnd: '2026-11-25', failReason: '', relatedDept: '', status: 'Complete' },
    });
    await http('orders-save-dates-new-order', '/api/orders/save-dates', {
      orderNo: 'V3T-GOLDEN-HTTP-NEW',
      department: 'delivery',
      fabricItems: firstItems,
      orderStatus: 'On Process',
    });
    await http('orders-save-dates-unauthenticated', '/api/orders/save-dates', { orderNo: first.orderNo, department: 'knitting' }, false);

    const text = JSON.stringify({ steps }, null, 1);
    const expected = readGolden(RECORDING);
    if (expected === null) {
      writeGolden(RECORDING, text);
      console.info(`[golden] recorded ${steps.length} save-dates steps to ${RECORDING}`);
      return;
    }
    if (text !== expected) {
      const want = JSON.parse(expected).steps as any[];
      expect(steps.length, 'number of recorded steps').toBe(want.length);
      for (let i = 0; i < steps.length; i++) {
        expect(steps[i], `step ${i}: ${steps[i].step}`).toEqual(want[i]);
      }
      // Same values but a different key order or number formatting.
      expect(text, 'recording text (key order)').toBe(expected);
    }
    expect(steps.length).toBeGreaterThan(200);
  });
});
