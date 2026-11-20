import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_CHECK_LIST_DEFAULTS } from '../src/constants/plan-check-list-defaults.js';
import { OrderPlanGuide } from '../src/models/OrderPlanGuide.model.js';
import { PlanningSetting } from '../src/models/PlanningSetting.model.js';
import { PlanCheckListService, canEditPlanCheckList } from '../src/services/plan-check-list.service.js';
import type { IAuthUser } from '../src/types/express.js';
import { formatDhakaDateTime } from '../src/utils/dhaka-time.js';
import { HttpError } from '../src/utils/http-error.js';
import { clearCollections, closeTestDb, openTestDb, rawCollection } from './helpers/local-mongo.js';

/** Plan Check List service (S2): seeding, reading, saving with validation, id policy and version check, usage. */

const DB = 'v3t_plan_check_list';

const user = (role: IAuthUser['role'], username: string, permissions: any = {}): IAuthUser => ({
  userId: `id-${username}`,
  username,
  role,
  permissions,
});
const admin = user('Admin', 'v3t_admin');
const editor = user('Planner', 'v3t_editor', { menus: { dataManagement: { planCheckList: true } } });
const viewer = user('Viewer', 'v3t_viewer');

/** The standard list of decision D9, exactly. */
const D9 = [
  { id: 'heatset', name: 'Heatset', startDays: 10, endDays: 7, active: true },
  { id: 'peach_brush', name: 'Peach/brush', startDays: 0, endDays: 0, active: true },
  { id: 'cpb', name: 'CPB', startDays: 12, endDays: 9, active: true },
  { id: 'singeing', name: 'Singeing', startDays: 7, endDays: 7, active: true },
  { id: 'subcontract', name: 'Subcontract', startDays: 0, endDays: 0, active: true },
  { id: 'yd_pre', name: 'YD Pre', startDays: 6, endDays: 4, active: true },
  { id: 'yd_post', name: 'YD Post', startDays: 6, endDays: 4, active: true },
  { id: 'mercerized', name: 'Mercerized', startDays: 11, endDays: 9, active: true },
  { id: 'semibleach', name: 'Semibleach', startDays: 6, endDays: 5, active: true },
];

const NEW_ID = /^chk_[0-9a-f]{24}$/;
const storedDoc = () => rawCollection('planningsettings').findOne({ _id: 'planCheckList' as any });

/** The error a promise rejects with (fails when it resolves). */
async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    return error as HttpError;
  }
  throw new Error('expected the call to fail');
}

/** Expects a 400 INVALID with exactly this message, and nothing written. */
async function expectInvalid(body: unknown, message: string) {
  const before = await storedDoc();
  const error = await rejection(PlanCheckListService.save(admin, body));
  expect(error).toBeInstanceOf(HttpError);
  expect(error.toJSON()).toEqual({ code: 'INVALID', message });
  expect(error.statusCode).toBe(400);
  expect(await storedDoc()).toEqual(before);
}

beforeAll(async () => {
  await openTestDb(DB, [PlanningSetting, OrderPlanGuide]);
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearCollections(['planningsettings', 'orderplanguides']);
});

describe('defaults (D9)', () => {
  it('are the nine standard criteria, all Active, in order, with fixed ids', () => {
    expect(PLAN_CHECK_LIST_DEFAULTS).toEqual(D9);
    expect(Object.isFrozen(PLAN_CHECK_LIST_DEFAULTS)).toBe(true);
  });
});

describe('seeding (ensure)', () => {
  it('creates the standard list on the first read', async () => {
    expect(await storedDoc()).toBeNull();
    const list = await PlanCheckListService.get(viewer);
    expect(list.items).toEqual(D9);
    expect(list.version).toBe(1);
    expect(list.updatedBy).toBe('system');
    expect(list.updatedAt).toBeInstanceOf(Date);
    const doc = await storedDoc();
    expect(doc).toMatchObject({ _id: 'planCheckList', value: D9, version: 1, updatedBy: 'system' });
    expect(doc!.createdAt).toEqual(doc!.updatedAt);
    expect(Object.keys(doc!).sort()).toEqual(['_id', 'createdAt', 'updatedAt', 'updatedBy', 'value', 'version']);
  });

  it('happens only once when the first reads race', async () => {
    const lists = await Promise.all(Array.from({ length: 12 }, (_, i) => PlanCheckListService.get(i % 2 ? admin : viewer)));
    expect(await rawCollection('planningsettings').countDocuments({})).toBe(1);
    for (const list of lists) {
      expect(list.items).toEqual(D9);
      expect(list.version).toBe(1);
    }
    const created = (await storedDoc())!.createdAt;
    expect(lists.every((list) => list.updatedAt!.getTime() === created.getTime())).toBe(true);
  });

  it('happens only once when ensure() itself races', async () => {
    await Promise.all(Array.from({ length: 20 }, () => PlanCheckListService.ensure()));
    expect(await rawCollection('planningsettings').countDocuments({})).toBe(1);
    expect((await storedDoc())!.version).toBe(1);
  });

  it('treats a duplicate-key error of a racing insert as done, and passes other errors on', async () => {
    vi.spyOn(PlanningSetting, 'updateOne').mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    await expect(PlanCheckListService.ensure()).resolves.toBeUndefined();
    vi.spyOn(PlanningSetting, 'updateOne').mockRejectedValueOnce(new Error('network down'));
    await expect(PlanCheckListService.ensure()).rejects.toThrow('network down');
  });

  it('never touches an existing list: reads do not change it or its updatedAt', async () => {
    await PlanCheckListService.get(admin);
    const first = await storedDoc();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await PlanCheckListService.ensure();
    await PlanCheckListService.get(admin);
    expect(await storedDoc()).toEqual(first);
  });

  it('never refills a list a user saved empty', async () => {
    await PlanCheckListService.get(admin);
    const saved = await PlanCheckListService.save(admin, { items: [], version: 1 });
    expect(saved.items).toEqual([]);
    expect(saved.version).toBe(2);
    await PlanCheckListService.ensure();
    const list = await PlanCheckListService.get(admin);
    expect(list.items).toEqual([]);
    expect(list.version).toBe(2);
    expect(list.updatedBy).toBe('v3t_admin');
  });
});

describe('get', () => {
  it('returns {items, version, updatedBy, updatedAt, defaults, canEdit, usage} for an editor', async () => {
    const list = await PlanCheckListService.get(admin);
    expect(Object.keys(list)).toEqual(['items', 'version', 'updatedBy', 'updatedAt', 'defaults', 'canEdit', 'usage']);
    expect(list.defaults).toEqual(D9);
    expect(list.canEdit).toBe(true);
  });

  it('leaves usage out for users who may not edit', async () => {
    const list = await PlanCheckListService.get(viewer);
    expect(Object.keys(list)).toEqual(['items', 'version', 'updatedBy', 'updatedAt', 'defaults', 'canEdit']);
    expect(list.canEdit).toBe(false);
    expect(list.items).toEqual(D9);
  });

  it('sends fresh copies of the defaults', async () => {
    const list = await PlanCheckListService.get(admin);
    list.defaults[0].name = 'changed';
    list.defaults.pop();
    expect((await PlanCheckListService.get(admin)).defaults).toEqual(D9);
    expect(PLAN_CHECK_LIST_DEFAULTS).toEqual(D9);
  });

  it('canEdit: Admin, or menus.dataManagement.planCheckList exactly true', () => {
    expect(canEditPlanCheckList(admin)).toBe(true);
    expect(canEditPlanCheckList(editor)).toBe(true);
    expect(canEditPlanCheckList(viewer)).toBe(false);
    expect(canEditPlanCheckList(user('Approver', 'a'))).toBe(false); // Approver is not Admin
    expect(canEditPlanCheckList(user('Planner', 'p', { menus: { dataManagement: { planCheckList: 'true' } } }))).toBe(false);
    expect(canEditPlanCheckList(user('Planner', 'p', { menus: { dataManagement: { setup: true, atlasMonitor: true } } }))).toBe(false);
    expect(canEditPlanCheckList(user('Viewer', 'v', undefined))).toBe(false);
    expect(canEditPlanCheckList(undefined)).toBe(false);
  });
});

describe('usage', () => {
  it('counts the order guides that have each id set to Yes (editors only)', async () => {
    await rawCollection('orderplanguides').insertMany([
      { _id: 'O-1', orderNo: 'O-1', yesIds: ['heatset', 'cpb'] },
      { _id: 'O-2', orderNo: 'O-2', yesIds: ['heatset'] },
      { _id: 'O-3', orderNo: 'O-3', yesIds: [] },
      { _id: 'O-4', orderNo: 'O-4' },
      { _id: 'O-5', orderNo: 'O-5', yesIds: ['chk_00000000000000000000dead'] },
      { _id: 'O-6', orderNo: 'O-6', yesIds: ['cpb', 'cpb'] },
    ] as any[]);
    const list = await PlanCheckListService.get(admin);
    expect(list.usage).toEqual({
      heatset: 2,
      peach_brush: 0,
      cpb: 2,
      singeing: 0,
      subcontract: 0,
      yd_pre: 0,
      yd_post: 0,
      mercerized: 0,
      semibleach: 0,
      chk_00000000000000000000dead: 1,
    });
    expect((await PlanCheckListService.get(editor)).usage).toEqual(list.usage);
    expect((await PlanCheckListService.get(viewer)).usage).toBeUndefined();
  });

  it('is sent with the answer of a save too', async () => {
    await rawCollection('orderplanguides').insertOne({ _id: 'O-1', orderNo: 'O-1', yesIds: ['semibleach'] } as any);
    await PlanCheckListService.get(admin);
    const saved = await PlanCheckListService.save(admin, { items: D9, version: 1 });
    expect(saved.usage!.semibleach).toBe(1);
  });
});

describe('save: validation (nothing is written on an error)', () => {
  beforeEach(async () => {
    await PlanCheckListService.get(admin);
  });

  const row = (over: Record<string, unknown> = {}) => ({ id: 'heatset', name: 'Heatset', startDays: 10, endDays: 7, active: true, ...over });
  const withRow = (index: number, over: Record<string, unknown>) => D9.map((item, i) => (i === index ? { ...item, ...over } : item));

  it('checks the body shape', async () => {
    await expectInvalid(undefined, 'Invalid Plan Check List data.');
    await expectInvalid([], 'Invalid Plan Check List data.');
    await expectInvalid({ version: 1 }, 'items: the list of criteria is required.');
    await expectInvalid({ items: {}, version: 1 }, 'items: the list of criteria is required.');
    await expectInvalid({ items: D9 }, 'version: the version of the list you loaded is required.');
    await expectInvalid({ items: D9, version: '1' }, 'version: the version of the list you loaded is required.');
    await expectInvalid({ items: D9, version: 1.5 }, 'version: the version of the list you loaded is required.');
  });

  it('allows at most 100 rows', async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => row({ id: undefined, name: `Criteria ${i + 1}` }));
    await expectInvalid({ items: rows(101), version: 1 }, 'The Plan Check List can have at most 100 criteria.');
    const saved = await PlanCheckListService.save(admin, { items: rows(100), version: 1 });
    expect(saved.items).toHaveLength(100);
  });

  it('names the row: each row must be an object', async () => {
    await expectInvalid({ items: [row(), null], version: 1 }, 'Row 2: Invalid criteria data.');
    await expectInvalid({ items: [[1]], version: 1 }, 'Row 1: Invalid criteria data.');
  });

  it('names the row: the name has 1 to 60 characters after trimming', async () => {
    const message = (n: number) => `Row ${n}: Criteria name must be 1 to 60 characters.`;
    await expectInvalid({ items: withRow(2, { name: '' }), version: 1 }, message(3));
    await expectInvalid({ items: withRow(0, { name: '   \t ' }), version: 1 }, message(1));
    await expectInvalid({ items: withRow(1, { name: 'x'.repeat(61) }), version: 1 }, message(2));
    await expectInvalid({ items: withRow(1, { name: 12 }), version: 1 }, message(2));
    await expectInvalid({ items: withRow(1, { name: undefined }), version: 1 }, message(2));
    const saved = await PlanCheckListService.save(admin, { items: withRow(1, { name: ` ${'y'.repeat(60)}  ` }), version: 1 });
    expect(saved.items[1].name).toBe('y'.repeat(60));
  });

  it('names the row: names are unique ignoring case and extra spaces', async () => {
    await expectInvalid(
      { items: withRow(4, { name: ' heatset ' }), version: 1 },
      'Row 5 (heatset): The name is already used in row 1 (Heatset).'
    );
    await expectInvalid(
      { items: withRow(8, { name: 'yd   PRE' }), version: 1 },
      'Row 9 (yd PRE): The name is already used in row 6 (YD Pre).'
    );
    // Regex characters are plain text (the check is done in JavaScript).
    const saved = await PlanCheckListService.save(admin, {
      items: [row({ name: 'Peach (brush)' }), row({ id: 'cpb', name: 'Peach .brush.' }), row({ id: 'x', name: 'C+' })],
      version: 1,
    });
    expect(saved.items.map((item) => item.name)).toEqual(['Peach (brush)', 'Peach .brush.', 'C+']);
  });

  it('names the row: Start and End days are whole numbers from 0 to 365', async () => {
    const start = 'Row 3 (CPB): Start days must be a whole number from 0 to 365.';
    for (const bad of [1.5, -1, 366, '10', null, undefined, Number.NaN, Infinity, true]) {
      await expectInvalid({ items: withRow(2, { startDays: bad }), version: 1 }, start);
    }
    const end = 'Row 3 (CPB): End days must be a whole number from 0 to 365.';
    for (const bad of [9.2, -3, 400, '9', null]) {
      await expectInvalid({ items: withRow(2, { endDays: bad }), version: 1 }, end);
    }
    const saved = await PlanCheckListService.save(admin, { items: withRow(2, { startDays: 365, endDays: 0 }), version: 1 });
    expect(saved.items[2]).toEqual({ id: 'cpb', name: 'CPB', startDays: 365, endDays: 0, active: true });
  });

  it('allows End below Start (as several standard criteria have)', async () => {
    const saved = await PlanCheckListService.save(admin, { items: [row({ startDays: 10, endDays: 2 })], version: 1 });
    expect(saved.items[0]).toEqual({ id: 'heatset', name: 'Heatset', startDays: 10, endDays: 2, active: true });
  });

  it('names the row: Active is true or false', async () => {
    for (const bad of ['true', 1, null, undefined]) {
      await expectInvalid({ items: withRow(0, { active: bad }), version: 1 }, 'Row 1 (Heatset): Active must be true or false.');
    }
  });

  it('reports the first bad row', async () => {
    const items = withRow(3, { startDays: -5 }).map((item, i) => (i === 6 ? { ...item, name: '' } : item));
    await expectInvalid({ items, version: 1 }, 'Row 4 (Singeing): Start days must be a whole number from 0 to 365.');
  });
});

describe('save: stored rows and id policy', () => {
  beforeEach(async () => {
    await PlanCheckListService.get(admin);
  });

  it('stores only the five fields, with the name trimmed and inner spaces collapsed', async () => {
    const saved = await PlanCheckListService.save(admin, {
      items: [{ id: 'heatset', name: '  Heat \t  set  ', startDays: 10, endDays: 7, active: false, usage: 5, extra: 'x' }],
      version: 1,
    });
    expect(saved.items).toEqual([{ id: 'heatset', name: 'Heat set', startDays: 10, endDays: 7, active: false }]);
    expect((await storedDoc())!.value).toEqual(saved.items);
  });

  it('keeps ids of the stored list and of the standard list; any other row gets a new chk_ id', async () => {
    // Remove CPB and add two criteria.
    const first = await PlanCheckListService.save(admin, {
      items: [
        { id: 'heatset', name: 'Heatset renamed', startDays: 10, endDays: 7, active: true },
        { name: 'No id', startDays: 1, endDays: 1, active: true },
        { id: 'made_up_by_client', name: 'Made-up id', startDays: 2, endDays: 2, active: true },
        { id: 42, name: 'Number id', startDays: 3, endDays: 3, active: true },
      ],
      version: 1,
    });
    const ids = first.items.map((item) => item.id);
    expect(ids[0]).toBe('heatset'); // a rename keeps the id
    expect(ids.slice(1).every((id) => NEW_ID.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(4);

    // Next save: the server's ids are now stored, so they are kept; CPB (a standard id) can come back.
    const second = await PlanCheckListService.save(admin, {
      items: [...first.items, { id: 'cpb', name: 'CPB', startDays: 12, endDays: 9, active: true }],
      version: 2,
    });
    expect(second.items.map((item) => item.id)).toEqual([...ids, 'cpb']);
  });

  it('gives a repeated id to the first row only', async () => {
    const saved = await PlanCheckListService.save(admin, {
      items: [
        { id: 'heatset', name: 'First', startDays: 1, endDays: 1, active: true },
        { id: 'heatset', name: 'Second', startDays: 2, endDays: 2, active: true },
      ],
      version: 1,
    });
    expect(saved.items[0].id).toBe('heatset');
    expect(saved.items[1].id).toMatch(NEW_ID);
  });

  it('records who saved, and raises the version by one', async () => {
    const saved = await PlanCheckListService.save(editor, { items: D9, version: 1 });
    expect(saved.version).toBe(2);
    expect(saved.updatedBy).toBe('v3t_editor');
    const doc = await storedDoc();
    expect(doc).toMatchObject({ version: 2, updatedBy: 'v3t_editor' });
    expect(doc!.updatedAt.getTime()).toBeGreaterThan(doc!.createdAt.getTime() - 1);
    expect(saved.updatedAt!.getTime()).toBe(doc!.updatedAt.getTime());
  });

  it('works when nobody read the list before (it is created first)', async () => {
    await clearCollections(['planningsettings']);
    const saved = await PlanCheckListService.save(admin, { items: D9.slice(0, 2), version: 1 });
    expect(saved.version).toBe(2);
    expect(saved.items).toEqual(D9.slice(0, 2));
  });
});

describe('save: version check and permission', () => {
  beforeEach(async () => {
    await PlanCheckListService.get(admin);
  });

  it('answers 409 CONFLICT naming who saved and when, and writes nothing', async () => {
    await PlanCheckListService.save(editor, { items: D9.slice(0, 3), version: 1 });
    const after = await storedDoc();
    const error = await rejection(PlanCheckListService.save(admin, { items: D9, version: 1 }));
    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(409);
    expect(error.toJSON()).toEqual({
      code: 'CONFLICT',
      message: `The Plan Check List was changed by v3t_editor at ${formatDhakaDateTime(after!.updatedAt)}. Reload the page to see the latest values.`,
    });
    expect(error.message).toMatch(/at \d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}\. Reload/);
    expect(await storedDoc()).toEqual(after);
  });

  it('lets only one of two saves of the same version through', async () => {
    const results = await Promise.allSettled([
      PlanCheckListService.save(admin, { items: D9.slice(0, 1), version: 1 }),
      PlanCheckListService.save(editor, { items: D9.slice(0, 2), version: 1 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason.statusCode).toBe(409);
    expect((await storedDoc())!.version).toBe(2);
  });

  it('answers 409 for a version the list never had', async () => {
    const error = await rejection(PlanCheckListService.save(admin, { items: D9, version: 7 }));
    expect(error.statusCode).toBe(409);
    expect(error.message).toMatch(/^The Plan Check List was changed by system at /);
  });

  it('refuses users without the permission with 403 PERMISSION (validation not even run)', async () => {
    for (const who of [viewer, user('Approver', 'v3t_approver'), user('Planner', 'p', { menus: { dataManagement: { setup: true } } })]) {
      const error = await rejection(PlanCheckListService.save(who, { items: 'not even valid' }));
      expect(error.statusCode).toBe(403);
      expect(error.toJSON()).toEqual({ code: 'PERMISSION', message: 'Access forbidden: Plan Check List permission required.' });
    }
    expect((await storedDoc())!.version).toBe(1);
  });
});

describe('formatDhakaDateTime', () => {
  it('shows Bangladesh time (UTC+6) whatever the server time zone', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Asia/Dhaka', 'America/New_York']) {
        process.env.TZ = tz;
        expect(formatDhakaDateTime(new Date('2026-11-20T19:05:00Z'))).toBe('21-Nov-2026 01:05');
        expect(formatDhakaDateTime('2026-09-01T00:00:00.000Z')).toBe('01-Sep-2026 06:00');
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    expect(formatDhakaDateTime(undefined)).toBe('');
    expect(formatDhakaDateTime('not a date')).toBe('');
  });
});
