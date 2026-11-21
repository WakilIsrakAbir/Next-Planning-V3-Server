import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeptValidOrders } from '../src/models/DeptValidOrders.model.js';
import { Order } from '../src/models/Order.model.js';
import { OrderDate } from '../src/models/OrderDate.model.js';
import { OrderService } from '../src/services/order.service.js';
import { PlanSaveService } from '../src/services/plan-save.service.js';
import { HttpError } from '../src/utils/http-error.js';
import { PLAN_DEPTS, UNSAVED_FINGERPRINT, fingerprintAllDepts, fingerprintDept } from '../src/utils/plan-fingerprint.js';
import { clearCollections, closeTestDb, openTestDb, rawCollection } from './helpers/local-mongo.js';
import { insertOrder, planRows, storedDocs, type Dept } from './helpers/plan-data.js';

/** POST /api/orders/save-plans at the service level (PlanSaveService), on the local test MongoDB. */

const DB = 'v3t_plan_save';
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

interface Plan {
  department: Dept;
  fabricItems: any[];
  orderStatus?: string;
  completedDate?: string;
}

const savePlans = (orderNo: string, plans: Plan[], base?: Record<string, string>) =>
  PlanSaveService.savePlans(wire({ orderNo, plans, ...(base ? { base } : {}) }));

const saveDates = (orderNo: string, plan: Plan) => OrderService.savePlanningDates(wire({ orderNo, ...plan }));

async function saveError(body: unknown): Promise<HttpError> {
  try {
    await PlanSaveService.savePlans(body);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('Expected save-plans to fail.');
}

const leanPlan = (orderNo: string) => OrderDate.findOne({ orderNo }).lean() as Promise<Record<string, any> | null>;
const leanOrder = (orderNo: string) => Order.findOne({ orderNo }).lean() as Promise<Record<string, any> | null>;
/** The fingerprints GET /api/orders/:orderNo gives the page right now. */
const pageBase = async (orderNo: string) => fingerprintAllDepts(await leanPlan(orderNo));

/** An order with saved Knitting (Confirm) and Dyeing (Tentative) plans, written by save-dates. */
async function plannedOrder(orderNo: string): Promise<void> {
  await insertOrder(orderNo, { yd: 1, knitting: 2, dyeing: 2, delivery: 2 });
  await saveDates(orderNo, { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Confirm'), orderStatus: 'On Process' });
  await saveDates(orderNo, { department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2, 'Tentative'), orderStatus: 'On Process' });
}

/** Makes OrderDate.findOneAndUpdate run `before(n)` (n = call number) right before the real write. */
function beforeEachWrite(before: (call: number) => Promise<void>) {
  const original = OrderDate.findOneAndUpdate.bind(OrderDate) as (...args: any[]) => any;
  let calls = 0;
  return vi.spyOn(OrderDate, 'findOneAndUpdate').mockImplementation(((...args: any[]) => {
    const call = ++calls;
    return {
      lean: async () => {
        await before(call);
        return original(...args).lean();
      },
    };
  }) as any);
}

/** Holds OrderDate.create until `count` calls are waiting, so that racing first saves really race. */
function holdCreates(count: number) {
  const original = OrderDate.create.bind(OrderDate) as (...args: any[]) => Promise<any>;
  let waiting = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const timer = setTimeout(() => release(), 5000);
  return vi.spyOn(OrderDate, 'create').mockImplementation((async (...args: any[]) => {
    if (++waiting >= count) {
      clearTimeout(timer);
      release();
    }
    await gate;
    return original(...args);
  }) as any);
}

beforeAll(async () => {
  await openTestDb(DB, [Order, OrderDate, DeptValidOrders]);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestDb();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearCollections(['orders', 'orderdates', 'deptvalidorders']);
  OrderService.clearReportCache();
});

describe('one department: the same documents as save-dates', () => {
  // Each case runs the same save once through save-dates and once through save-plans, from the same starting
  // state, and compares the stored OrderDate and Order (raw BSON, _id and timestamps left out, key order included).
  const cases: { name: string; setup: (orderNo: string) => Promise<void>; plan: (orderNo: string) => Plan; base: 'none' | 'page' }[] = [
    {
      name: 'existing plan, no base',
      setup: plannedOrder,
      plan: (o) => ({ department: 'dyeing', fabricItems: planRows(o, 'dyeing', 2, 'Confirm'), orderStatus: 'Confirm' }),
      base: 'none',
    },
    {
      name: 'existing plan, with base (checked write)',
      setup: plannedOrder,
      plan: (o) => ({ department: 'dyeing', fabricItems: planRows(o, 'dyeing', 2, 'Confirm'), orderStatus: 'Confirm' }),
      base: 'page',
    },
    {
      name: 'first Delivery save on an existing OrderDate, with base',
      setup: plannedOrder,
      plan: (o) => ({ department: 'delivery', fabricItems: planRows(o, 'delivery', 2, 'Tentative'), orderStatus: 'On Process' }),
      base: 'page',
    },
    {
      name: 'Completed with a completed date, with base',
      setup: plannedOrder,
      plan: (o) => ({ department: 'knitting', fabricItems: planRows(o, 'knitting', 2, 'Confirm'), orderStatus: 'Completed', completedDate: '2026-11-21' }),
      base: 'page',
    },
    {
      name: 'no Order Status sent (the stored status stays)',
      setup: plannedOrder,
      plan: (o) => ({ department: 'knitting', fabricItems: planRows(o, 'knitting', 2, 'Tentative') }),
      base: 'page',
    },
    {
      name: 'empty Order Status (not written, as in save-dates)',
      setup: plannedOrder,
      plan: (o) => ({ department: 'knitting', fabricItems: planRows(o, 'knitting', 2, ''), orderStatus: '' }),
      base: 'none',
    },
    {
      name: 'YD with barrier and workable quantities, with base',
      setup: plannedOrder,
      plan: (o) => ({ department: 'yd', fabricItems: planRows(o, 'yd', 1, 'Confirm', { barrierQty: '10', workableQty: '90' }), orderStatus: 'On Process' }),
      base: 'page',
    },
    {
      name: 'Finishing without Excel rows, no base',
      setup: plannedOrder,
      plan: (o) => ({ department: 'finishing', fabricItems: planRows(o, 'finishing', 1, 'Select'), orderStatus: 'Pending' }),
      base: 'none',
    },
    {
      name: 'first save of the order (no OrderDate yet), no base',
      setup: (o) => insertOrder(o),
      plan: (o) => ({ department: 'knitting', fabricItems: planRows(o, 'knitting', 2, 'Confirm'), orderStatus: 'On Process' }),
      base: 'none',
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const orderNo = 'V3T-SAME-1';
      await c.setup(orderNo);
      await saveDates(orderNo, c.plan(orderNo));
      const viaSaveDates = await storedDocs(orderNo);

      await clearCollections(['orders', 'orderdates']);
      await c.setup(orderNo);
      const base = c.base === 'page' ? { [c.plan(orderNo).department]: (await pageBase(orderNo))[c.plan(orderNo).department] } : undefined;
      const result = await savePlans(orderNo, [c.plan(orderNo)], base);
      const viaSavePlans = await storedDocs(orderNo);

      expect(viaSavePlans.orderDates).toBe(1);
      expect(JSON.stringify(viaSavePlans)).toBe(JSON.stringify(viaSaveDates));
      expect(result.statusSynced).toBe(true);
    });
  }

  it('first save of the order with base (create): the same fields and values; only the key order differs', async () => {
    const orderNo = 'V3T-SAME-2';
    const plan: Plan = { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Confirm'), orderStatus: 'On Process' };
    await insertOrder(orderNo);
    await saveDates(orderNo, plan);
    const viaSaveDates = await storedDocs(orderNo);

    await clearCollections(['orders', 'orderdates']);
    await insertOrder(orderNo);
    expect(await leanPlan(orderNo)).toBeNull();
    const createSpy = vi.spyOn(OrderDate, 'create');
    await savePlans(orderNo, [plan], { knitting: UNSAVED_FINGERPRINT });
    const viaSavePlans = await storedDocs(orderNo);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(viaSavePlans.orderDates).toBe(1);
    expect(viaSavePlans).toEqual(viaSaveDates); // deep equality ignores key order
    expect(Object.keys(viaSavePlans.orderDate).sort()).toEqual(Object.keys(viaSaveDates.orderDate).sort());
  });
});

describe('several departments in one save', () => {
  it('writes them with ONE OrderDate update and ONE Order status update, like save-dates one after another', async () => {
    const orderNo = 'V3T-MULTI-1';
    const plans: Plan[] = [
      { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Confirm'), orderStatus: 'On Process' },
      { department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2, 'Tentative'), orderStatus: 'On Process' },
      { department: 'delivery', fabricItems: planRows(orderNo, 'delivery', 2, ''), orderStatus: 'Pending' },
    ];
    await plannedOrder(orderNo);
    for (const plan of plans) await saveDates(orderNo, plan);
    const sequential = await storedDocs(orderNo);

    await clearCollections(['orders', 'orderdates']);
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    const writes = vi.spyOn(OrderDate, 'findOneAndUpdate');
    const statusWrites = vi.spyOn(Order, 'updateOne');
    const clears = vi.spyOn(OrderService, 'clearReportCache');
    const result = await savePlans(orderNo, plans, base);

    expect(writes).toHaveBeenCalledTimes(1);
    const [filter, update, options] = writes.mock.calls[0] as any[];
    expect(Object.keys(filter)).toEqual(['orderNo', 'updatedAt']);
    expect(Object.keys(update.$set)).toEqual(['knitting', 'knittingStatus', 'dyeing', 'dyeingStatus', 'delivery', 'deliveryStatus']);
    expect(options).toMatchObject({ upsert: false, returnDocument: 'after' });
    expect(statusWrites).toHaveBeenCalledTimes(1);
    expect((statusWrites.mock.calls[0] as any[])[1]).toEqual({
      $set: { knittingPlanStatus: 'Confirm', dyeingPlanStatus: 'Tentative', deliveryPlanStatus: 'Pending' },
    });
    expect(clears).toHaveBeenCalledTimes(1);
    expect(result.planStatuses).toEqual({ knitting: 'Confirm', dyeing: 'Tentative', delivery: 'Pending' });
    expect(await storedDocs(orderNo)).toEqual(sequential);
  });

  it('writes nothing at all when the plan write fails', async () => {
    const orderNo = 'V3T-MULTI-2';
    await plannedOrder(orderNo);
    const before = await storedDocs(orderNo);
    vi.spyOn(OrderDate, 'findOneAndUpdate').mockImplementation((() => ({
      lean: async () => {
        throw new Error('simulated database failure');
      },
    })) as any);
    const statusWrites = vi.spyOn(Order, 'updateOne');
    await expect(
      savePlans(orderNo, [
        { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative'), orderStatus: 'Completed' },
        { department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2, 'Confirm'), orderStatus: 'Confirm' },
      ])
    ).rejects.toThrow('simulated database failure');
    expect(statusWrites).not.toHaveBeenCalled();
    expect(await storedDocs(orderNo)).toEqual(before);
  });

  it('refuses the whole save when one of its departments conflicts', async () => {
    const orderNo = 'V3T-MULTI-3';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    // Someone else saves Knitting after the page loaded.
    await saveDates(orderNo, { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative'), orderStatus: 'On Process' });
    const before = await storedDocs(orderNo);

    const error = await saveError(
      wire({
        orderNo,
        plans: [
          { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Confirm'), orderStatus: 'Confirm' },
          { department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2, 'Confirm'), orderStatus: 'Confirm' },
        ],
        base,
      })
    );
    expect(error.statusCode).toBe(409);
    expect(error.toJSON()).toEqual({
      code: 'CONFLICT',
      message: 'Knitting was changed by someone else after this order was opened.',
      departments: ['knitting'],
    });
    expect(await storedDocs(orderNo)).toEqual(before);
  });
});

describe('400 INVALID', () => {
  const orderNo = 'V3T-INVALID';
  const plan = () => ({ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 1) });
  const cases: [string, unknown, RegExp][] = [
    ['the body is not an object', [], /^Expected object, received array$/],
    ['no orderNo', { plans: [plan()] }, /^orderNo: Required$/],
    ['a blank orderNo', { orderNo: '  ', plans: [plan()] }, /^orderNo: The order number is required\.$/],
    ['a number as orderNo', { orderNo: 5, plans: [plan()] }, /^orderNo: Expected string/],
    ['no plans', { orderNo }, /^plans: Required$/],
    ['an empty plans list', { orderNo, plans: [] }, /^plans: At least one department is required\.$/],
    ['plans that is not a list', { orderNo, plans: { department: 'knitting' } }, /^plans: Expected array/],
    ['more than 5 plans', { orderNo, plans: Array.from({ length: 6 }, plan) }, /^plans: at most 5 departments/],
    ['an unknown department', { orderNo, plans: [{ ...plan(), department: 'printing' }] }, /^plans\.0\.department: Invalid enum value/],
    ['a Tracking department', { orderNo, plans: [{ ...plan(), department: 'knittingActual' }] }, /^plans\.0\.department: Invalid enum value/],
    ['a department twice', { orderNo, plans: [plan(), plan()] }, /^plans\.1\.department: Each department may appear only once\.$/],
    ['no fabricItems', { orderNo, plans: [{ department: 'knitting' }] }, /^plans\.0\.fabricItems: Required$/],
    ['empty fabricItems', { orderNo, plans: [{ ...plan(), fabricItems: [] }] }, /^plans\.0\.fabricItems: At least one item is required\.$/],
    ['fabricItems that is not a list', { orderNo, plans: [{ ...plan(), fabricItems: { a: 1 } }] }, /^plans\.0\.fabricItems: Expected array/],
    ['an item that is a string', { orderNo, plans: [{ ...plan(), fabricItems: [{ itemId: 'a' }, 'x'] }] }, /^plans\.0\.fabricItems\.1: Each item must be an object\.$/],
    ['an item that is null', { orderNo, plans: [{ ...plan(), fabricItems: [null] }] }, /^plans\.0\.fabricItems\.0: Each item must be an object\.$/],
    ['an item that is a list', { orderNo, plans: [{ ...plan(), fabricItems: [[1]] }] }, /^plans\.0\.fabricItems\.0: Each item must be an object\.$/],
    ['a number as orderStatus', { orderNo, plans: [{ ...plan(), orderStatus: 3 }] }, /^plans\.0\.orderStatus: Expected string/],
    ['null as completedDate', { orderNo, plans: [{ ...plan(), completedDate: null }] }, /^plans\.0\.completedDate: Expected string/],
    ['a base for an unknown department', { orderNo, plans: [plan()], base: { printing: 'x' } }, /^base\.printing: Invalid enum value/],
    ['a base that is not text', { orderNo, plans: [plan()], base: { knitting: 7 } }, /^base\.knitting: Expected string/],
  ];

  for (const [name, body, message] of cases) {
    it(`refuses ${name}, and writes nothing`, async () => {
      await insertOrder(orderNo);
      const error = await saveError(body);
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('INVALID');
      expect(error.message).toMatch(message);
      expect(Object.keys(error.toJSON())).toEqual(['code', 'message']);
      expect(await rawCollection('orderdates').countDocuments()).toBe(0);
    });
  }
});

describe('404', () => {
  it('refuses an order that does not exist, with or without base, and creates no OrderDate', async () => {
    for (const base of [undefined, { knitting: UNSAVED_FINGERPRINT }]) {
      const error = await saveError(
        wire({ orderNo: 'V3T-NO-SUCH-ORDER', plans: [{ department: 'knitting', fabricItems: planRows('X', 'knitting', 1) }], base })
      );
      expect(error.statusCode).toBe(404);
      expect(error.toJSON()).toEqual({ message: 'Order "V3T-NO-SUCH-ORDER" not found.' });
    }
    expect(await rawCollection('orderdates').countDocuments()).toBe(0);
  });
});

describe('409 CONFLICT (base fingerprints)', () => {
  it('refuses a department another user saved after the page loaded, and keeps their save', async () => {
    const orderNo = 'V3T-CONFLICT-1';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    const theirs = planRows(orderNo, 'dyeing', 2, 'Confirm', { remarks: 'their change' });
    await saveDates(orderNo, { department: 'dyeing', fabricItems: theirs, orderStatus: 'Confirm' });
    const before = await storedDocs(orderNo);

    const error = await saveError(
      wire({ orderNo, plans: [{ department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2, 'Tentative') }], base: { dyeing: base.dyeing } })
    );
    expect(error.statusCode).toBe(409);
    expect(error.toJSON()).toEqual({
      code: 'CONFLICT',
      message: 'Dyeing was changed by someone else after this order was opened.',
      departments: ['dyeing'],
    });
    expect(await storedDocs(orderNo)).toEqual(before);
    expect((await leanPlan(orderNo))!.dyeing[0].remarks).toBe('their change');
  });

  it('names every changed department, in pipeline order', async () => {
    const orderNo = 'V3T-CONFLICT-2';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    await saveDates(orderNo, { department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2, 'Confirm'), orderStatus: 'Confirm' });
    await saveDates(orderNo, { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative'), orderStatus: 'Confirm' });
    const error = await saveError(
      wire({
        orderNo,
        plans: [
          { department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 1, 'Tentative') },
          { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 1, 'Confirm') },
        ],
        base,
      })
    );
    expect(error.toJSON()).toEqual({
      code: 'CONFLICT',
      message: 'Knitting and Dyeing were changed by someone else after this order was opened.',
      departments: ['knitting', 'dyeing'],
    });
  });

  it('detects V2 edits of Unit / Process (itemData only) and a changed Order Status', async () => {
    const orderNo = 'V3T-CONFLICT-3';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    await rawCollection('orderdates').updateOne({ orderNo }, { $set: { 'dyeing.0.itemData.Unit': 'Unit-9' } });
    let error = await saveError(wire({ orderNo, plans: [{ department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2) }], base }));
    expect(error.statusCode).toBe(409);

    await rawCollection('orderdates').updateOne({ orderNo }, { $set: { knittingStatus: 'Completed' } });
    error = await saveError(
      wire({ orderNo, plans: [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2), orderStatus: 'On Process' }], base })
    );
    expect(error.toJSON().departments).toEqual(['knitting']);
    // The same rows without an Order Status would store exactly what is there now: not a conflict.
    await expect(savePlans(orderNo, [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2) }], base)).resolves.toBeTruthy();
  });

  it('is not raised by a file upload that only refreshes Excel quantities', async () => {
    const orderNo = 'V3T-CONFLICT-4';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    await rawCollection('orderdates').updateOne(
      { orderNo },
      { $set: { 'dyeing.0.itemData.DyeingProd': 555, 'dyeing.1.itemData.RequiredQtyKgs': 1, updatedAt: new Date() } }
    );
    const result = await savePlans(orderNo, [{ department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2, 'Confirm') }], base);
    expect(result.planStatuses).toEqual({ dyeing: 'Confirm' });
  });
});

describe('concurrent saves', () => {
  it('another department saved between the read and the write gives NO false 409', async () => {
    const orderNo = 'V3T-RACE-1';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    const theirDyeing = planRows(orderNo, 'dyeing', 2, 'Confirm', { remarks: 'saved in between' });
    const writes = beforeEachWrite(async (call) => {
      if (call === 1) {
        // Another user's Dyeing save lands after save-plans read the document and before it writes.
        await rawCollection('orderdates').updateOne(
          { orderNo },
          { $set: { dyeing: theirDyeing, dyeingStatus: 'Confirm', updatedAt: new Date(Date.now() + 60_000) } }
        );
      }
    });
    const mine = planRows(orderNo, 'knitting', 2, 'Tentative', { remarks: 'mine' });
    const result = await savePlans(orderNo, [{ department: 'knitting', fabricItems: mine, orderStatus: 'On Process' }], { knitting: base.knitting });

    expect(writes).toHaveBeenCalledTimes(2); // the first write missed (updatedAt changed), the re-check passed
    const stored = (await leanPlan(orderNo))!;
    expect(stored.knitting).toEqual(mine);
    expect(stored.dyeing).toEqual(theirDyeing);
    expect(result.planData!.dyeing).toEqual(theirDyeing);
    expect(result.planStatuses).toEqual({ knitting: 'Tentative' });
  });

  it('the same department saved between the read and the write gives 409, and keeps their save', async () => {
    const orderNo = 'V3T-RACE-2';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    const theirs = planRows(orderNo, 'knitting', 2, 'Confirm', { remarks: 'theirs' });
    beforeEachWrite(async (call) => {
      if (call === 1) {
        await rawCollection('orderdates').updateOne({ orderNo }, { $set: { knitting: theirs, updatedAt: new Date(Date.now() + 60_000) } });
      }
    });
    const error = await saveError(
      wire({ orderNo, plans: [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative') }], base: { knitting: base.knitting } })
    );
    expect(error.statusCode).toBe(409);
    expect(error.toJSON().departments).toEqual(['knitting']);
    expect((await leanPlan(orderNo))!.knitting).toEqual(theirs);
  });

  it('gives up after 3 write attempts when the document keeps changing, writing nothing', async () => {
    const orderNo = 'V3T-RACE-3';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    const before = (await leanPlan(orderNo))!.knitting;
    const writes = beforeEachWrite(async (call) => {
      await rawCollection('orderdates').updateOne({ orderNo }, { $set: { updatedAt: new Date(Date.now() + call * 60_000) } });
    });
    const error = await saveError(
      wire({ orderNo, plans: [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative') }], base })
    );
    expect(writes).toHaveBeenCalledTimes(3);
    expect(error.statusCode).toBe(500);
    expect(error.toJSON()).toEqual({ message: 'The order kept changing while it was being saved. Nothing was saved; please save again.' });
    expect((await leanPlan(orderNo))!.knitting).toEqual(before);
  });

  it('two racing first saves of different departments both succeed, in ONE document', async () => {
    const orderNo = 'V3T-RACE-4';
    await insertOrder(orderNo);
    expect((await OrderDate.collection.indexes()).some((i) => i.unique && i.key.orderNo === 1)).toBe(true);
    const creates = holdCreates(2);
    const knitting = planRows(orderNo, 'knitting', 2, 'Confirm');
    const dyeing = planRows(orderNo, 'dyeing', 2, 'Tentative');
    const [a, b] = await Promise.all([
      savePlans(orderNo, [{ department: 'knitting', fabricItems: knitting, orderStatus: 'On Process' }], { knitting: UNSAVED_FINGERPRINT }),
      savePlans(orderNo, [{ department: 'dyeing', fabricItems: dyeing, orderStatus: 'On Process' }], { dyeing: UNSAVED_FINGERPRINT }),
    ]);
    expect(creates).toHaveBeenCalledTimes(2); // both tried to create; one got the duplicate-key error and updated instead
    expect(await rawCollection('orderdates').countDocuments({ orderNo })).toBe(1);
    const stored = (await leanPlan(orderNo))!;
    expect(stored.knitting).toEqual(knitting);
    expect(stored.dyeing).toEqual(dyeing);
    expect([a.planStatuses, b.planStatuses]).toEqual([{ knitting: 'Confirm' }, { dyeing: 'Tentative' }]);
    const order = (await leanOrder(orderNo))!;
    expect([order.knittingPlanStatus, order.dyeingPlanStatus]).toEqual(['Confirm', 'Tentative']);
  });

  it('two racing first saves of the same department: one wins, the other gets 409', async () => {
    const orderNo = 'V3T-RACE-5';
    await insertOrder(orderNo);
    holdCreates(2);
    const rowsA = planRows(orderNo, 'knitting', 2, 'Confirm', { remarks: 'A' });
    const rowsB = planRows(orderNo, 'knitting', 2, 'Tentative', { remarks: 'B' });
    const results = await Promise.allSettled([
      savePlans(orderNo, [{ department: 'knitting', fabricItems: rowsA }], { knitting: UNSAVED_FINGERPRINT }),
      savePlans(orderNo, [{ department: 'knitting', fabricItems: rowsB }], { knitting: UNSAVED_FINGERPRINT }),
    ]);
    const won = results.findIndex((r) => r.status === 'fulfilled');
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(lost.reason).toBeInstanceOf(HttpError);
    expect(lost.reason.statusCode).toBe(409);
    expect(lost.reason.toJSON().departments).toEqual(['knitting']);
    expect(await rawCollection('orderdates').countDocuments({ orderNo })).toBe(1);
    expect((await leanPlan(orderNo))!.knitting).toEqual(won === 0 ? rowsA : rowsB);
  });

  it('the same first save sent twice at once succeeds twice, in one document', async () => {
    const orderNo = 'V3T-RACE-6';
    await insertOrder(orderNo);
    holdCreates(2);
    const rows = planRows(orderNo, 'delivery', 2, 'Confirm');
    const request = () => savePlans(orderNo, [{ department: 'delivery', fabricItems: rows, orderStatus: 'On Process' }], { delivery: UNSAVED_FINGERPRINT });
    const [a, b] = await Promise.all([request(), request()]);
    expect(a.fingerprints.delivery).toBe(b.fingerprints.delivery);
    expect(await rawCollection('orderdates').countDocuments({ orderNo })).toBe(1);
  });

  it('racing first saves without base (save-dates\' upsert) still make one document', async () => {
    const orderNo = 'V3T-RACE-7';
    await insertOrder(orderNo, { yd: 1, knitting: 1, dyeing: 1, delivery: 1 });
    const depts: Dept[] = ['yd', 'knitting', 'dyeing', 'finishing', 'delivery'];
    await Promise.all(depts.map((d) => savePlans(orderNo, [{ department: d, fabricItems: planRows(orderNo, d, 1, 'Confirm'), orderStatus: 'On Process' }])));
    expect(await rawCollection('orderdates').countDocuments({ orderNo })).toBe(1);
    const stored = (await leanPlan(orderNo))!;
    for (const d of depts) expect(stored[d], d).toEqual(planRows(orderNo, d, 1, 'Confirm'));
  });

  it('a page opened before the first save of the order can still save another department', async () => {
    const orderNo = 'V3T-RACE-8';
    await insertOrder(orderNo);
    const base = await pageBase(orderNo); // no OrderDate yet
    expect(Object.values(base)).toEqual(PLAN_DEPTS.map(() => UNSAVED_FINGERPRINT));
    // Another user's Knitting save creates the OrderDate, with 'On Process' and no rows for the other departments.
    await saveDates(orderNo, { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Confirm'), orderStatus: 'On Process' });
    expect((await leanPlan(orderNo))!.dyeingStatus).toBe('On Process');

    const dyeing = planRows(orderNo, 'dyeing', 2, 'Tentative');
    await savePlans(orderNo, [{ department: 'dyeing', fabricItems: dyeing, orderStatus: 'On Process' }], { dyeing: base.dyeing });
    const stored = (await leanPlan(orderNo))!;
    expect(stored.dyeing).toEqual(dyeing);
    expect(stored.knitting).toEqual(planRows(orderNo, 'knitting', 2, 'Confirm'));
    // ...but not the department that other user saved.
    const error = await saveError(wire({ orderNo, plans: [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative') }], base }));
    expect(error.toJSON().departments).toEqual(['knitting']);
  });

  it('works on an old OrderDate without timestamps or YD fields', async () => {
    const orderNo = 'V3T-RACE-9';
    await insertOrder(orderNo);
    await rawCollection('orderdates').insertOne({ orderNo, knitting: planRows(orderNo, 'knitting', 1), knittingStatus: 'On Process', dyeing: [], dyeingStatus: 'On Process' });
    const base = await pageBase(orderNo);
    expect(base.yd).toBe(UNSAVED_FINGERPRINT);
    const yd = planRows(orderNo, 'yd', 1, 'Confirm');
    const result = await savePlans(orderNo, [{ department: 'yd', fabricItems: yd, orderStatus: 'On Process' }], { yd: base.yd, knitting: base.knitting });
    expect(result.planData!.yd).toEqual(yd);
    expect(result.planData!.updatedAt).toBeInstanceOf(Date);
  });
});

describe('sending the same request again', () => {
  it('succeeds, even though its base is now out of date', async () => {
    const orderNo = 'V3T-AGAIN-1';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    const plans: Plan[] = [
      { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative'), orderStatus: 'Tentative' },
      { department: 'delivery', fabricItems: planRows(orderNo, 'delivery', 2, 'Confirm'), orderStatus: 'On Process' },
    ];
    const first = await savePlans(orderNo, plans, base);
    expect(first.fingerprints.knitting).not.toBe(base.knitting);
    const again = await savePlans(orderNo, plans, base);
    expect(again.fingerprints).toEqual(first.fingerprints);
    expect(await rawCollection('orderdates').countDocuments({ orderNo })).toBe(1);
  });

  it('a request that sends no Order Status is compared with the stored status', async () => {
    const orderNo = 'V3T-AGAIN-2';
    await plannedOrder(orderNo);
    const base = await pageBase(orderNo);
    const rows = planRows(orderNo, 'dyeing', 2, 'Confirm');
    await savePlans(orderNo, [{ department: 'dyeing', fabricItems: rows }], base);
    await expect(savePlans(orderNo, [{ department: 'dyeing', fabricItems: rows }], base)).resolves.toMatchObject({ statusSynced: true });
  });
});

describe('without base', () => {
  it('is a plain $set (last write wins): no conflict check, other departments untouched', async () => {
    const orderNo = 'V3T-PLAIN-1';
    await plannedOrder(orderNo);
    await saveDates(orderNo, { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative', { remarks: 'theirs' }) });
    const dyeingBefore = (await leanPlan(orderNo))!.dyeing;
    const writes = vi.spyOn(OrderDate, 'findOneAndUpdate');
    const creates = vi.spyOn(OrderDate, 'create');
    const mine = planRows(orderNo, 'knitting', 2, 'Confirm', { remarks: 'mine' });

    await savePlans(orderNo, [{ department: 'knitting', fabricItems: mine, orderStatus: 'Confirm' }]);

    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toEqual({ orderNo });
    expect(writes.mock.calls[0][2]).toEqual({ returnDocument: 'after', upsert: true });
    expect(creates).not.toHaveBeenCalled();
    const stored = (await leanPlan(orderNo))!;
    expect(stored.knitting).toEqual(mine);
    expect(stored.knittingStatus).toBe('Confirm');
    expect(stored.dyeing).toEqual(dyeingBefore);
  });

  it('an empty base, or a base only for departments not being saved, also means no check', async () => {
    const orderNo = 'V3T-PLAIN-2';
    await plannedOrder(orderNo);
    await saveDates(orderNo, { department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 1, 'Tentative') });
    const writes = vi.spyOn(OrderDate, 'findOneAndUpdate');
    await savePlans(orderNo, [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2) }], {});
    await savePlans(orderNo, [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2) }], { dyeing: 'stale' });
    expect(writes.mock.calls.map((c) => c[0])).toEqual([{ orderNo }, { orderNo }]);
  });
});

describe('response', () => {
  it('has the message, the fresh planData, the statuses, statusSynced and all five fingerprints', async () => {
    const orderNo = 'V3T-RESPONSE-1';
    await plannedOrder(orderNo);
    const result = await savePlans(orderNo, [
      { department: 'dyeing', fabricItems: planRows(orderNo, 'dyeing', 2, 'Confirm'), orderStatus: 'Completed', completedDate: '2026-11-21' },
    ]);
    expect(Object.keys(result)).toEqual(['message', 'planData', 'planStatuses', 'statusSynced', 'fingerprints']);
    expect(result.message).toBe('Planning Data saved successfully!');
    expect(result.planData).toEqual(await leanPlan(orderNo));
    expect(result.planData!.dyeingCompletedDate).toBe('2026-11-21');
    expect(result.planStatuses).toEqual({ dyeing: 'Completed' });
    expect((await leanOrder(orderNo))!.dyeingPlanStatus).toBe('Completed');
    expect(result.statusSynced).toBe(true);
    expect(result.fingerprints).toEqual(fingerprintAllDepts(result.planData));
    expect(Object.keys(result.fingerprints)).toEqual([...PLAN_DEPTS]);
  });

  it('statusSynced is false (still a success) when the status write fails twice; the plans are saved', async () => {
    const orderNo = 'V3T-RESPONSE-2';
    await plannedOrder(orderNo);
    const statusBefore = (await leanOrder(orderNo))!.knittingPlanStatus;
    const statusWrites = vi.spyOn(Order, 'updateOne').mockRejectedValue(new Error('simulated status failure'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rows = planRows(orderNo, 'knitting', 2, 'Tentative');
    const result = await savePlans(orderNo, [{ department: 'knitting', fabricItems: rows, orderStatus: 'On Process' }]);
    expect(statusWrites).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    expect(result.statusSynced).toBe(false);
    expect(result.planStatuses).toEqual({ knitting: 'Tentative' });
    expect((await leanPlan(orderNo))!.knitting).toEqual(rows);
    statusWrites.mockRestore();
    expect((await leanOrder(orderNo))!.knittingPlanStatus).toBe(statusBefore);
  });

  it('a status write that fails once is retried', async () => {
    const orderNo = 'V3T-RESPONSE-3';
    await plannedOrder(orderNo);
    const statusWrites = vi.spyOn(Order, 'updateOne').mockRejectedValueOnce(new Error('simulated status failure'));
    const result = await savePlans(orderNo, [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative') }]);
    expect(statusWrites).toHaveBeenCalledTimes(2);
    expect(result.statusSynced).toBe(true);
    expect((await leanOrder(orderNo))!.knittingPlanStatus).toBe('Tentative');
  });

  it('uses only planType for the Delivery status, as save-dates does', async () => {
    const orderNo = 'V3T-RESPONSE-4';
    await plannedOrder(orderNo);
    const result = await savePlans(orderNo, [
      { department: 'delivery', fabricItems: planRows(orderNo, 'delivery', 2, '', { floorPlanType: 'Confirm' }), orderStatus: 'On Process' },
    ]);
    expect(result.planStatuses).toEqual({ delivery: 'Pending' });
  });
});

describe('fingerprints', () => {
  it('are stable across reads and match the save response', async () => {
    const orderNo = 'V3T-FP-1';
    await plannedOrder(orderNo);
    const saved = await savePlans(orderNo, [{ department: 'delivery', fabricItems: planRows(orderNo, 'delivery', 2, 'Confirm') }]);
    const first = await OrderService.getOrderDetails(orderNo, 'delivery', { fresh: true });
    const second = await OrderService.getOrderDetails(orderNo, 'knitting', { fresh: true });
    OrderService.clearReportCache();
    const third = await OrderService.getOrderDetails(orderNo);
    expect(first.fingerprints).toEqual(saved.fingerprints);
    expect(second.fingerprints).toEqual(saved.fingerprints);
    expect(third.fingerprints).toEqual(saved.fingerprints);
    expect(fingerprintDept(await leanPlan(orderNo), 'delivery')).toBe(saved.fingerprints.delivery);
  });

  it('of untouched departments do not change when another department is saved', async () => {
    const orderNo = 'V3T-FP-2';
    await plannedOrder(orderNo);
    const before = await pageBase(orderNo);
    const after = await savePlans(orderNo, [{ department: 'knitting', fabricItems: planRows(orderNo, 'knitting', 2, 'Tentative') }], before);
    expect(after.fingerprints.knitting).not.toBe(before.knitting);
    for (const d of ['yd', 'dyeing', 'finishing', 'delivery'] as const) expect(after.fingerprints[d], d).toBe(before[d]);
  });
});
