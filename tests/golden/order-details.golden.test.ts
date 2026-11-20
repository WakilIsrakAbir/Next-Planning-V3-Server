import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { DeptValidOrders } from '../../src/models/DeptValidOrders.model.js';
import { Order } from '../../src/models/Order.model.js';
import { OrderDate } from '../../src/models/OrderDate.model.js';
import { User } from '../../src/models/User.model.js';
import { OrderService } from '../../src/services/order.service.js';
import { createTestUser, requestJson, startApp, type RunningApp } from '../helpers/http.js';
import { closeTestDb, openTestDb } from '../helpers/local-mongo.js';
import { goldenFile, loadGoldenFixtures, readGolden, seedGoldenOrders, writeGolden, type GoldenFixtures } from './golden-fixtures.js';

// The app's env module would read the server's .env (live database URI); tests use a stand-in.
vi.mock('../../src/config/env.js', () => import('../helpers/test-env.js'));

/**
 * GOLDEN MASTER for the order details read (GET /api/orders/:orderNo, OrderService.getOrderDetails).
 * Records the `order` and `planData` it returns for the 13 real golden orders (including the fallbacks it fills in),
 * so fields added later (fingerprints, deptFlags) are proven not to change what was already there.
 * Recorded on the unmodified code before S1; real data, so it stays in tests/golden/local (gitignored).
 */

const DB = 'v3t_golden_order_details';
const RECORDING = goldenFile('order-details.golden.json');
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('golden: order details (order + planData)', () => {
  let fixtures: GoldenFixtures | null = null;
  let running: RunningApp | null = null;
  let token = '';

  beforeAll(async () => {
    fixtures = await loadGoldenFixtures();
    if (!fixtures) return;
    await openTestDb(DB, [Order, OrderDate, User, DeptValidOrders]);
    await seedGoldenOrders(fixtures);
    running = await startApp(app);
    token = await createTestUser('Admin', 'v3t_golden_reader');
  });

  afterAll(async () => {
    if (running) await running.close();
    await closeTestDb();
  });

  it('returns exactly the recorded order and planData', async (ctx) => {
    if (!fixtures) {
      ctx.skip('No local golden fixtures and no abir_test on the local test MongoDB.');
      return;
    }
    const reads: any[] = [];
    const orderNos = [...fixtures.orders.map((o) => o.orderNo), 'V3T-GOLDEN-NO-ORDER'];
    for (const orderNo of orderNos) {
      for (const dept of [undefined, 'knitting', 'delivery']) {
        OrderService.clearReportCache();
        try {
          const result: any = await OrderService.getOrderDetails(orderNo, dept);
          reads.push({ read: `service ${orderNo} ${dept ?? '(no dept)'}`, order: wire(result.order), planData: wire(result.planData) });
        } catch (err: any) {
          reads.push({ read: `service ${orderNo} ${dept ?? '(no dept)'}`, thrown: String(err?.message ?? err) });
        }
      }
      OrderService.clearReportCache();
      const res = await requestJson(running!.baseUrl, 'GET', `/api/orders/${encodeURIComponent(orderNo)}?dept=dyeing`, token);
      reads.push({
        read: `http ${orderNo}`,
        status: res.status,
        ...(res.status === 200 ? { order: res.body.order, planData: res.body.planData } : { body: res.body }),
      });
    }

    const text = JSON.stringify({ reads }, null, 1);
    const expected = readGolden(RECORDING);
    if (expected === null) {
      writeGolden(RECORDING, text);
      console.info(`[golden] recorded ${reads.length} order-details reads to ${RECORDING}`);
      return;
    }
    if (text !== expected) {
      const want = JSON.parse(expected).reads as any[];
      expect(reads.length, 'number of recorded reads').toBe(want.length);
      for (let i = 0; i < reads.length; i++) {
        expect(reads[i], `read ${i}: ${reads[i].read}`).toEqual(want[i]);
      }
      expect(text, 'recording text (key order)').toBe(expected);
    }
    expect(reads.length).toBeGreaterThan(40);
  });
});
