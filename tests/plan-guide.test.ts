import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_CHECK_LIST_DEFAULTS } from '../src/constants/plan-check-list-defaults.js';
import { DeptValidOrders } from '../src/models/DeptValidOrders.model.js';
import { Order } from '../src/models/Order.model.js';
import { OrderDate } from '../src/models/OrderDate.model.js';
import { OrderPlanGuide } from '../src/models/OrderPlanGuide.model.js';
import { PlanningSetting } from '../src/models/PlanningSetting.model.js';
import { OrderService } from '../src/services/order.service.js';
import { PlanCheckListService } from '../src/services/plan-check-list.service.js';
import { PlanGuideService } from '../src/services/plan-guide.service.js';
import type { IAuthUser } from '../src/types/express.js';
import { formatDhakaDateTime } from '../src/utils/dhaka-time.js';
import { HttpError } from '../src/utils/http-error.js';
import { computeGuideDefaults } from '../src/utils/plan-guide-dates.js';
import { clearCollections, closeTestDb, openTestDb, rawCollection } from './helpers/local-mongo.js';
import { insertOrder, planRows } from './helpers/plan-data.js';

/** PUT plan-guide at the service level (S3), and the guide in the order details. */

const DB = 'v3t_plan_guide';

const planner: IAuthUser = { userId: 'u1', username: 'v3t_planner', role: 'Planner', permissions: {} };
const viewer: IAuthUser = { userId: 'u2', username: 'v3t_viewer', role: 'Viewer', permissions: {} };
const admin: IAuthUser = { userId: 'u3', username: 'v3t_admin', role: 'Admin', permissions: {} };

/** The user's example: T&A Knitting 2 to 21 October 2026. */
const TNA = {
  yarnDate: '2026-09-28',
  knitStart: '2026-10-02',
  knitEnd: '2026-10-21',
  dyeStart: '2026-10-15',
  dyeEnd: '2026-10-30',
  deliStart: '2026-11-02',
  deliEnd: 'TBA',
};
const ORDER_NO = 'V3T-G1';

/** The dates the page shows for the example with Heatset Yes (lead 10/7), Lock entered by hand. */
const DATES = { ...computeGuideDefaults(TNA, { startDays: 10, endDays: 7 }), lockStart: '2026-11-20', lockEnd: '2026-11-25' };

async function insertGuideOrder(orderNo = ORDER_NO, tna: Record<string, unknown> = TNA) {
  await Order.create({ orderNo, buyer: 'V3T BUYER', ...tna, knittingItems: [{ OrderNo: orderNo, Color: 'NAVY' }] });
}

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    return error as HttpError;
  }
  throw new Error('expected the call to fail');
}

async function expectError(promise: Promise<unknown>, status: number, body: Record<string, unknown>) {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(HttpError);
  expect(error.statusCode).toBe(status);
  expect(error.toJSON()).toEqual(body);
}

const guideDoc = (orderNo = ORDER_NO) => rawCollection('orderplanguides').findOne({ _id: orderNo as any });

beforeAll(async () => {
  await openTestDb(DB, [Order, OrderDate, OrderPlanGuide, PlanningSetting, DeptValidOrders]);
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearCollections(['orders', 'orderdates', 'orderplanguides', 'planningsettings', 'deptvalidorders']);
  OrderService.clearReportCache();
});

describe('PUT plan-guide: first save', () => {
  it('stores yesIds, the ten dates, the server-computed lead and the snapshots, as version 1', async () => {
    await insertGuideOrder();
    const guide = await PlanGuideService.save(planner, ORDER_NO, { yesIds: ['heatset'], dates: DATES });
    expect(guide).toMatchObject({
      _id: ORDER_NO,
      orderNo: ORDER_NO,
      yesIds: ['heatset'],
      dates: DATES,
      lead: { startDays: 10, endDays: 7, startFrom: ['Heatset'], endFrom: ['Heatset'] },
      checks: PLAN_CHECK_LIST_DEFAULTS,
      tna: TNA,
      checklistVersion: 1,
      version: 1,
      updatedBy: 'v3t_planner',
    });
    expect(guide.createdAt).toBeInstanceOf(Date);
    expect(guide.updatedAt).toBeInstanceOf(Date);

    const stored = await guideDoc();
    expect(Object.keys(stored!).sort()).toEqual(
      ['_id', 'checks', 'checklistVersion', 'createdAt', 'dates', 'lead', 'orderNo', 'tna', 'updatedAt', 'updatedBy', 'version', 'yesIds'].sort()
    );
    expect(stored!.dates).toEqual(DATES);
    expect(stored!.tna.deliEnd).toBe('TBA'); // raw T&A value
    expect(JSON.parse(JSON.stringify(stored))).toEqual(JSON.parse(JSON.stringify(guide)));
  });

  it('stores a guide with every criterion No and every date blank', async () => {
    await insertGuideOrder();
    const blank = Object.fromEntries(Object.keys(DATES).map((key) => [key, '']));
    const guide = await PlanGuideService.save(viewer, ORDER_NO, { yesIds: [], dates: blank, version: null });
    expect(guide.lead).toEqual({ startDays: 0, endDays: 0, startFrom: [], endFrom: [] });
    expect(guide.dates).toEqual(blank);
    expect(guide.yesIds).toEqual([]);
  });

  it('computes the lead itself from the current Plan Check List (D10), ignoring what the page sends', async () => {
    await insertGuideOrder();
    await PlanCheckListService.get(admin);
    const list = PLAN_CHECK_LIST_DEFAULTS.map((item) =>
      item.id === 'heatset' ? { ...item, startDays: 10, endDays: 3 } : item.id === 'singeing' ? { ...item, startDays: 8, endDays: 7 } : item
    );
    await PlanCheckListService.save(admin, { items: list, version: 1 });

    const guide = await PlanGuideService.save(planner, ORDER_NO, {
      yesIds: ['heatset', 'singeing'],
      dates: DATES,
      lead: { startDays: 99, endDays: 99, startFrom: ['x'], endFrom: ['x'] },
      checks: [],
      tna: {},
      checklistVersion: 42,
      version: undefined,
    });
    expect(guide.lead).toEqual({ startDays: 10, endDays: 7, startFrom: ['Heatset'], endFrom: ['Singeing'] });
    expect(guide.checklistVersion).toBe(2);
    expect(guide.checks).toEqual(list);
    expect(guide.tna).toEqual(TNA);
  });

  it('snapshots the raw T&A, blank when the Order has none', async () => {
    await insertGuideOrder('V3T-G2', { knitStart: '2026-10-02' });
    const guide = await PlanGuideService.save(planner, 'V3T-G2', { yesIds: [], dates: DATES });
    expect(guide.tna).toEqual({ yarnDate: '', knitStart: '2026-10-02', knitEnd: '', dyeStart: '', dyeEnd: '', deliStart: '', deliEnd: '' });
  });
});

describe('PUT plan-guide: later saves and 409', () => {
  beforeEach(async () => {
    await insertGuideOrder();
    await PlanGuideService.save(planner, ORDER_NO, { yesIds: ['heatset'], dates: DATES });
  });

  it('updates with the loaded version and raises it by one', async () => {
    const dates = { ...DATES, knitEnd: '2026-10-30' };
    const guide = await PlanGuideService.save(viewer, ORDER_NO, { yesIds: ['heatset', 'cpb'], dates, version: 1 });
    expect(guide).toMatchObject({ version: 2, yesIds: ['heatset', 'cpb'], dates, updatedBy: 'v3t_viewer' });
    expect(guide.lead).toEqual({ startDays: 12, endDays: 9, startFrom: ['CPB'], endFrom: ['CPB'] });
    expect(await rawCollection('orderplanguides').countDocuments({})).toBe(1);
  });

  it('answers 409 CONFLICT for an old version, naming who saved and when; nothing is written', async () => {
    await PlanGuideService.save(admin, ORDER_NO, { yesIds: [], dates: DATES, version: 1 });
    const before = await guideDoc();
    await expectError(PlanGuideService.save(planner, ORDER_NO, { yesIds: ['cpb'], dates: DATES, version: 1 }), 409, {
      code: 'CONFLICT',
      message: `The Planning Guide of this order was changed by v3t_admin at ${formatDhakaDateTime(before!.updatedAt)}. Reload the page to see the latest values.`,
    });
    expect(await guideDoc()).toEqual(before);
  });

  it('answers 409 (reload), not 400, to an old page whose Yes became invalid through the newer save', async () => {
    // A page loads version 2 (CPB Yes). Someone else then sets CPB to No (version 3) and an admin makes CPB
    // inactive. The old page still has CPB as Yes.
    await PlanGuideService.save(admin, ORDER_NO, { yesIds: ['heatset', 'cpb'], dates: DATES, version: 1 });
    await PlanGuideService.save(admin, ORDER_NO, { yesIds: ['heatset'], dates: DATES, version: 2 });
    await PlanCheckListService.save(admin, {
      items: PLAN_CHECK_LIST_DEFAULTS.map((item) => (item.id === 'cpb' ? { ...item, active: false } : item)),
      version: 1,
    });
    const error = await rejection(PlanGuideService.save(planner, ORDER_NO, { yesIds: ['heatset', 'cpb'], dates: DATES, version: 2 }));
    expect(error.statusCode).toBe(409);
    expect(error.toJSON().code).toBe('CONFLICT');
  });

  it('answers 409 to a page that loaded no guide (no version) once one exists', async () => {
    const error = await rejection(PlanGuideService.save(admin, ORDER_NO, { yesIds: [], dates: DATES }));
    expect(error.statusCode).toBe(409);
    expect(error.toJSON().code).toBe('CONFLICT');
  });

  it('answers 409 when another save gets in between the check and the write', async () => {
    const realFind = OrderPlanGuide.findOneAndUpdate.bind(OrderPlanGuide);
    vi.spyOn(OrderPlanGuide, 'findOneAndUpdate').mockImplementationOnce(((filter: any, update: any, options: any) => {
      // Someone else saves right before this write.
      return {
        lean: async () => {
          await rawCollection('orderplanguides').updateOne({ _id: ORDER_NO as any }, { $inc: { version: 1 }, $set: { updatedBy: 'v3t_other' } });
          return realFind(filter, update, options).lean();
        },
      } as any;
    }) as any);
    const error = await rejection(PlanGuideService.save(planner, ORDER_NO, { yesIds: [], dates: DATES, version: 1 }));
    expect(error.statusCode).toBe(409);
    expect(error.message).toMatch(/^The Planning Guide of this order was changed by v3t_other at /);
    expect((await guideDoc())!.yesIds).toEqual(['heatset']);
  });

  it('lets only one of two saves of the same version through', async () => {
    const results = await Promise.allSettled([
      PlanGuideService.save(planner, ORDER_NO, { yesIds: ['cpb'], dates: DATES, version: 1 }),
      PlanGuideService.save(viewer, ORDER_NO, { yesIds: ['singeing'], dates: DATES, version: 1 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.statusCode).toBe(409);
    expect((await guideDoc())!.version).toBe(2);
  });
});

describe('PUT plan-guide: racing first saves', () => {
  it('never creates two guides: one first save wins, the other gets 409', async () => {
    await insertGuideOrder();
    const results = await Promise.allSettled([
      PlanGuideService.save(planner, ORDER_NO, { yesIds: ['cpb'], dates: DATES }),
      PlanGuideService.save(viewer, ORDER_NO, { yesIds: ['heatset'], dates: DATES }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason.statusCode).toBe(409);
    expect(refused.reason.code).toBe('CONFLICT');
    expect(await rawCollection('orderplanguides').countDocuments({})).toBe(1);
    expect((await guideDoc())!.version).toBe(1);
  });

  it('passes on errors other than a duplicate key', async () => {
    await insertGuideOrder();
    vi.spyOn(OrderPlanGuide, 'create').mockRejectedValueOnce(new Error('disk full'));
    await expect(PlanGuideService.save(planner, ORDER_NO, { yesIds: [], dates: DATES })).rejects.toThrow('disk full');
  });
});

describe('PUT plan-guide: 404 and 400', () => {
  it('answers 404 for an unknown order (before looking at the body)', async () => {
    await expectError(PlanGuideService.save(planner, 'V3T-NOPE', { yesIds: 'bad', dates: null }), 404, {
      message: 'Order "V3T-NOPE" not found.',
    });
    expect(await rawCollection('orderplanguides').countDocuments({})).toBe(0);
  });

  it("answers 400 INVALID for dates that are not '' or a real 'YYYY-MM-DD' day", async () => {
    await insertGuideOrder();
    const bad = (message: string) => ({ code: 'INVALID', message });
    await expectError(PlanGuideService.save(planner, ORDER_NO, undefined), 400, bad('Invalid Planning Guide data.'));
    await expectError(PlanGuideService.save(planner, ORDER_NO, { yesIds: [] }), 400, bad('dates: the guide dates are required.'));
    await expectError(PlanGuideService.save(planner, ORDER_NO, { yesIds: [], dates: [] }), 400, bad('dates: the guide dates are required.'));
    const cases: [string, unknown][] = [
      ['knitStart', '2026-02-30'],
      ['knitEnd', 'TBA'],
      ['ydStart', '-'],
      ['dyeStart', '10/15/2026'],
      ['dyeEnd', 46297],
      ['floorStart', null],
      ['lockEnd', undefined],
      ['floorEnd', ' 2026-11-02'],
    ];
    for (const [key, value] of cases) {
      await expectError(
        PlanGuideService.save(planner, ORDER_NO, { yesIds: [], dates: { ...DATES, [key]: value } }),
        400,
        bad(`dates.${key}: must be empty or a date (YYYY-MM-DD).`)
      );
    }
    for (const version of [0, -1, 1.5, '1']) {
      await expectError(
        PlanGuideService.save(planner, ORDER_NO, { yesIds: [], dates: DATES, version }),
        400,
        bad('version: must be the version of the guide you loaded.')
      );
    }
    expect(await rawCollection('orderplanguides').countDocuments({})).toBe(0);
  });

  it('answers 400 INVALID for yesIds that are not unique Active criteria', async () => {
    await insertGuideOrder();
    await PlanCheckListService.get(admin);
    await PlanCheckListService.save(admin, {
      items: PLAN_CHECK_LIST_DEFAULTS.map((item) => (item.id === 'cpb' ? { ...item, active: false } : item)),
      version: 1,
    });
    const bad = (message: string) => ({ code: 'INVALID', message });
    const save = (yesIds: unknown) => PlanGuideService.save(planner, ORDER_NO, { yesIds, dates: DATES });
    await expectError(save(undefined), 400, bad('yesIds: the list of checkpoints set to Yes is required.'));
    await expectError(save('heatset'), 400, bad('yesIds: the list of checkpoints set to Yes is required.'));
    await expectError(save([5]), 400, bad('yesIds: each entry must be a checkpoint id.'));
    await expectError(save(['']), 400, bad('yesIds: each entry must be a checkpoint id.'));
    await expectError(save(['heatset', 'heatset']), 400, bad('Checkpoint "Heatset" is set to Yes more than once.'));
    await expectError(save(['heatset', 'cpb']), 400, bad('Checkpoint "CPB" is inactive in the Plan Check List, so it cannot be set to Yes.'));
    await expectError(save(['no_such_id']), 400, bad('Checkpoint "no_such_id" is not in the Plan Check List.'));
    expect(await rawCollection('orderplanguides').countDocuments({})).toBe(0);
  });
});

describe('PUT plan-guide: criteria made Inactive or removed after the guide was saved', () => {
  it('keeps them as Yes when already Yes on the stored guide; they no longer count, and a removed one keeps its name', async () => {
    await insertGuideOrder();
    await PlanCheckListService.get(admin);
    const custom = { id: '', name: 'Special Wash', startDays: 20, endDays: 15, active: true };
    const withCustom = await PlanCheckListService.save(admin, { items: [...PLAN_CHECK_LIST_DEFAULTS, custom], version: 1 });
    const customId = withCustom.items[9].id;
    expect(customId).toMatch(/^chk_[0-9a-f]{24}$/);

    const first = await PlanGuideService.save(planner, ORDER_NO, { yesIds: ['cpb', customId, 'heatset'], dates: DATES });
    expect(first.lead).toEqual({ startDays: 20, endDays: 15, startFrom: ['Special Wash'], endFrom: ['Special Wash'] });

    // The list then makes CPB inactive and removes Special Wash.
    await PlanCheckListService.save(admin, {
      items: PLAN_CHECK_LIST_DEFAULTS.map((item) => (item.id === 'cpb' ? { ...item, active: false } : item)),
      version: 2,
    });

    const again = await PlanGuideService.save(planner, ORDER_NO, { yesIds: ['cpb', customId, 'heatset'], dates: DATES, version: 1 });
    expect(again.yesIds).toEqual(['cpb', customId, 'heatset']);
    expect(again.lead).toEqual({ startDays: 10, endDays: 7, startFrom: ['Heatset'], endFrom: ['Heatset'] });
    expect(again.checklistVersion).toBe(3);
    expect(again.checks.find((check) => check.id === 'cpb')).toEqual({ id: 'cpb', name: 'CPB', startDays: 12, endDays: 9, active: false });
    expect(again.checks.find((check) => check.id === customId)).toEqual({
      id: customId,
      name: 'Special Wash',
      startDays: 20,
      endDays: 15,
      active: false,
    });
    expect(again.checks).toHaveLength(10);

    // Once set to No, they cannot come back.
    const no = await PlanGuideService.save(planner, ORDER_NO, { yesIds: ['heatset'], dates: DATES, version: 2 });
    expect(no.checks).toHaveLength(9);
    await expectError(PlanGuideService.save(planner, ORDER_NO, { yesIds: ['heatset', 'cpb'], dates: DATES, version: 3 }), 400, {
      code: 'INVALID',
      message: 'Checkpoint "CPB" is inactive in the Plan Check List, so it cannot be set to Yes.',
    });
    await expectError(PlanGuideService.save(planner, ORDER_NO, { yesIds: [customId], dates: DATES, version: 3 }), 400, {
      code: 'INVALID',
      message: `Checkpoint "${customId}" is not in the Plan Check List.`,
    });
  });
});

describe('the guide never changes plans, T&A or statuses (D13)', () => {
  it('leaves the Order and its OrderDate exactly as they were', async () => {
    await insertOrder('V3T-G3', { knitting: 2, dyeing: 1 });
    await OrderService.savePlanningDates({ orderNo: 'V3T-G3', department: 'knitting', fabricItems: planRows('V3T-G3', 'knitting', 2), orderStatus: 'On Process' });
    const order = await rawCollection('orders').findOne({ orderNo: 'V3T-G3' });
    const planData = await rawCollection('orderdates').findOne({ orderNo: 'V3T-G3' });

    await PlanGuideService.save(planner, 'V3T-G3', { yesIds: ['cpb', 'heatset'], dates: DATES });
    await PlanGuideService.save(planner, 'V3T-G3', { yesIds: [], dates: DATES, version: 1 });

    expect(await rawCollection('orders').findOne({ orderNo: 'V3T-G3' })).toEqual(order);
    expect(await rawCollection('orderdates').findOne({ orderNo: 'V3T-G3' })).toEqual(planData);
  });
});

describe('order details: guide', () => {
  it('is null before the first save, then the saved guide', async () => {
    await insertGuideOrder();
    const before = await OrderService.getOrderDetails(ORDER_NO, 'knitting');
    expect(before.guide).toBeNull();

    const saved = await PlanGuideService.save(planner, ORDER_NO, { yesIds: ['heatset'], dates: DATES });
    // The save cleared this order's cached details, so a normal read already has the guide.
    const after = await OrderService.getOrderDetails(ORDER_NO, 'knitting');
    expect(after).not.toBe(before);
    expect(JSON.parse(JSON.stringify(after.guide))).toEqual(JSON.parse(JSON.stringify(saved)));
    expect(Object.keys(after)).toEqual(['order', 'planData', 'fingerprints', 'deptFlags', 'guide']);
  });

  it('reads the guide by its _id, the order number', async () => {
    await insertGuideOrder();
    const findById = vi.spyOn(OrderPlanGuide, 'findById');
    await OrderService.getOrderDetails(ORDER_NO);
    expect(findById).toHaveBeenCalledWith(ORDER_NO);
  });
});

describe('clearOrderDetailCache', () => {
  it("forgets every cached ?dept variant of that order only", async () => {
    await insertGuideOrder('V3T-A');
    await insertGuideOrder('V3T-B');
    const a1 = await OrderService.getOrderDetails('V3T-A', 'knitting');
    const a2 = await OrderService.getOrderDetails('V3T-A');
    const b1 = await OrderService.getOrderDetails('V3T-B', 'knitting');
    expect(await OrderService.getOrderDetails('V3T-A', 'knitting')).toBe(a1);

    OrderService.clearOrderDetailCache('V3T-A');
    expect(await OrderService.getOrderDetails('V3T-A', 'knitting')).not.toBe(a1);
    expect(await OrderService.getOrderDetails('V3T-A')).not.toBe(a2);
    expect(await OrderService.getOrderDetails('V3T-B', 'knitting')).toBe(b1);
  });
});
