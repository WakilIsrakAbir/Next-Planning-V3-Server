import type { Request } from 'express';
import { Types } from 'mongoose';
import { planCheckListDefaults } from '../constants/plan-check-list-defaults.js';
import { OrderPlanGuide } from '../models/OrderPlanGuide.model.js';
import { IPlanCheckItem, PlanningSetting } from '../models/PlanningSetting.model.js';
import { formatDhakaDateTime } from '../utils/dhaka-time.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Plan Check List (Data Management > Plan Check List): the criteria whose Yes on an order's Checkpoint & Planning
 * Guide adds days to the Knitting T&A dates. One versioned document in `planningsettings` (_id 'planCheckList').
 *
 * - Every signed-in user may read it (order pages need it), so reading never answers 403.
 * - Saving needs Admin or menus.dataManagement.planCheckList === true; the whole list is saved at once, with an
 *   optimistic version check (409 CONFLICT when someone else saved first).
 */

type AuthUser = Request['user'];

export const PLAN_CHECK_LIST_ID = 'planCheckList';
export const MAX_CRITERIA = 100;
export const MAX_NAME_LENGTH = 60;
export const MAX_DAYS = 365;

/** GET /api/plan-check-list (and the answer of a save). */
export interface PlanCheckListView {
  items: IPlanCheckItem[];
  version: number;
  updatedBy: string;
  updatedAt: Date | null;
  /** The standard list, for "Reset to Standard" (a draft-only change on the page). */
  defaults: IPlanCheckItem[];
  /** The user may save the list. */
  canEdit: boolean;
  /** Editors only: the number of order guides that have each criterion id set to Yes. */
  usage?: Record<string, number>;
}

/** The current list and its version (used by the order guide save). */
export interface PlanCheckListCurrent {
  items: IPlanCheckItem[];
  version: number;
}

/** Admin, or the Data Management > Plan Check List permission ticked (a missing key means no). */
export function canEditPlanCheckList(user: AuthUser): boolean {
  return !!user && (user.role === 'Admin' || user.permissions?.menus?.dataManagement?.planCheckList === true);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const invalid = (message: string): HttpError => new HttpError(400, message, 'INVALID');

const storedItems = (value: unknown): IPlanCheckItem[] => (Array.isArray(value) ? (value as IPlanCheckItem[]) : []);

const isDays = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_DAYS;

const newCriterionId = (): string => `chk_${new Types.ObjectId().toHexString()}`;

/**
 * Checks every row and returns the list to store: each row reduced to its five fields, names trimmed with inner
 * spaces collapsed, and ids following the id policy (an id is kept only when it is in `knownIds` and not used by an
 * earlier row; any other row gets a new `chk_<ObjectId>` id). Throws 400 INVALID naming the first bad row.
 */
export function validatePlanCheckItems(items: unknown[], knownIds: Set<string>): IPlanCheckItem[] {
  if (items.length > MAX_CRITERIA) {
    throw invalid(`The Plan Check List can have at most ${MAX_CRITERIA} criteria.`);
  }
  const rowsByName = new Map<string, { row: number; name: string }>();
  const usedIds = new Set<string>();
  return items.map((raw, index) => {
    const row = index + 1;
    if (!isPlainObject(raw)) throw invalid(`Row ${row}: Invalid criteria data.`);

    const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
    const length = Array.from(name).length;
    if (length < 1 || length > MAX_NAME_LENGTH) {
      throw invalid(`Row ${row}: Criteria name must be 1 to ${MAX_NAME_LENGTH} characters.`);
    }
    const label = `Row ${row} (${name})`;
    const key = name.toLowerCase();
    const first = rowsByName.get(key);
    if (first) throw invalid(`${label}: The name is already used in row ${first.row} (${first.name}).`);
    rowsByName.set(key, { row, name });

    if (!isDays(raw.startDays)) throw invalid(`${label}: Start days must be a whole number from 0 to ${MAX_DAYS}.`);
    if (!isDays(raw.endDays)) throw invalid(`${label}: End days must be a whole number from 0 to ${MAX_DAYS}.`);
    if (typeof raw.active !== 'boolean') throw invalid(`${label}: Active must be true or false.`);

    const id = typeof raw.id === 'string' && knownIds.has(raw.id) && !usedIds.has(raw.id) ? raw.id : newCriterionId();
    usedIds.add(id);
    // `+ 0` turns -0 into 0.
    return { id, name, startDays: raw.startDays + 0, endDays: raw.endDays + 0, active: raw.active };
  });
}

/** `{items, version}` of a save request; throws 400 INVALID for any other shape. */
function parseSaveBody(body: unknown): { items: unknown[]; version: number } {
  if (!isPlainObject(body)) throw invalid('Invalid Plan Check List data.');
  if (!Array.isArray(body.items)) throw invalid('items: the list of criteria is required.');
  if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0) {
    throw invalid('version: the version of the list you loaded is required.');
  }
  return { items: body.items, version: body.version };
}

export class PlanCheckListService {
  /**
   * Creates the list with the standard criteria when it does not exist yet. Safe when several requests race (one
   * upsert on the fixed _id), and it never touches an existing list, even an empty one a user saved.
   * Timestamps are set here by hand: Mongoose's automatic ones would also set updatedAt on an existing list.
   */
  static async ensure(): Promise<void> {
    const now = new Date();
    try {
      await PlanningSetting.updateOne(
        { _id: PLAN_CHECK_LIST_ID },
        {
          $setOnInsert: {
            value: planCheckListDefaults(),
            version: 1,
            updatedBy: 'system',
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, timestamps: false }
      );
    } catch (error: any) {
      // A racing first read created it between the match and the insert.
      if (error?.code !== 11000) throw error;
    }
  }

  /** The stored document, created with the standard criteria on first use. */
  private static async load() {
    const existing = await PlanningSetting.findById(PLAN_CHECK_LIST_ID).lean();
    if (existing) return existing;
    await PlanCheckListService.ensure();
    const created = await PlanningSetting.findById(PLAN_CHECK_LIST_ID).lean();
    if (!created) throw new Error('The Plan Check List could not be created.');
    return created;
  }

  /** The current criteria and version. */
  static async current(): Promise<PlanCheckListCurrent> {
    const doc = await PlanCheckListService.load();
    return { items: storedItems(doc.value), version: doc.version };
  }

  /**
   * For every criterion id that order guides set to Yes, the number of guides doing so; the ids of `items` that no
   * guide uses are included with 0.
   */
  static async usage(items: IPlanCheckItem[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.id] = 0;
    const rows = await OrderPlanGuide.aggregate<{ _id: unknown; n: number }>([
      { $match: { 'yesIds.0': { $exists: true } } },
      { $unwind: '$yesIds' },
      // count each guide once per id, even if an id were listed twice
      { $group: { _id: { id: '$yesIds', guide: '$_id' } } },
      { $group: { _id: '$_id.id', n: { $sum: 1 } } },
    ]);
    for (const row of rows) {
      if (typeof row._id === 'string') counts[row._id] = row.n;
    }
    return counts;
  }

  private static async view(user: AuthUser, doc: { value: unknown; version: number; updatedBy: string; updatedAt?: Date }): Promise<PlanCheckListView> {
    const items = storedItems(doc.value);
    const canEdit = canEditPlanCheckList(user);
    const view: PlanCheckListView = {
      items,
      version: doc.version,
      updatedBy: doc.updatedBy || '',
      updatedAt: doc.updatedAt ?? null,
      defaults: planCheckListDefaults(),
      canEdit,
    };
    if (canEdit) view.usage = await PlanCheckListService.usage(items);
    return view;
  }

  /** GET /api/plan-check-list. Any signed-in user; `usage` only for users who may edit. */
  static async get(user: AuthUser): Promise<PlanCheckListView> {
    return PlanCheckListService.view(user, await PlanCheckListService.load());
  }

  /**
   * PUT /api/plan-check-list with `{items, version}`. Validates everything first (400 INVALID, naming the row), then
   * writes only if the stored version is still `version` (409 CONFLICT otherwise). Returns the saved list (as GET).
   */
  static async save(user: AuthUser, body: unknown): Promise<PlanCheckListView> {
    if (!canEditPlanCheckList(user)) {
      throw new HttpError(403, 'Access forbidden: Plan Check List permission required.', 'PERMISSION');
    }
    const { items, version } = parseSaveBody(body);

    const stored = await PlanCheckListService.load();
    const knownIds = new Set<string>([
      ...storedItems(stored.value).map((item) => item?.id),
      ...planCheckListDefaults().map((item) => item.id),
    ].filter((id): id is string => typeof id === 'string'));
    const value = validatePlanCheckItems(items, knownIds);

    const saved = await PlanningSetting.findOneAndUpdate(
      { _id: PLAN_CHECK_LIST_ID, version },
      { $set: { value, updatedBy: user?.username || '' }, $inc: { version: 1 } },
      { returnDocument: 'after' }
    ).lean();
    if (!saved) throw await PlanCheckListService.conflict();
    return PlanCheckListService.view(user, saved);
  }

  /** The 409 of a save that lost the race, naming who saved the list and when (Bangladesh time). */
  private static async conflict(): Promise<HttpError> {
    const latest = await PlanningSetting.findById(PLAN_CHECK_LIST_ID, { updatedBy: 1, updatedAt: 1 }).lean();
    const who = latest?.updatedBy || 'another user';
    const when = formatDhakaDateTime(latest?.updatedAt);
    return new HttpError(
      409,
      `The Plan Check List was changed by ${who}${when ? ` at ${when}` : ''}. Reload the page to see the latest values.`,
      'CONFLICT'
    );
  }
}
