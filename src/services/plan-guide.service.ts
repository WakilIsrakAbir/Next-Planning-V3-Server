import type { Request } from 'express';
import { Order } from '../models/Order.model.js';
import { IGuideCheck, IGuideTna, IOrderPlanGuide, OrderPlanGuide } from '../models/OrderPlanGuide.model.js';
import { formatDhakaDateTime } from '../utils/dhaka-time.js';
import { HttpError } from '../utils/http-error.js';
import { GUIDE_DATE_KEYS, GuideDates, TNA_KEYS, computeLead, isIsoDay } from '../utils/plan-guide-dates.js';
import { OrderService } from './order.service.js';
import { PlanCheckListService } from './plan-check-list.service.js';

/**
 * PUT /api/orders/:orderNo/plan-guide: saves an order's Checkpoint & Planning Guide (the Yes/No checkpoints and the
 * ten guide dates) in the V3-only `orderplanguides` collection.
 *
 * - Any signed-in user may save it (whoever can open the order page).
 * - It stores what the page shows (yesIds and the ten dates) plus what the server computes itself: the lead from the
 *   CURRENT Plan Check List, and snapshots of the list, of the order's T&A values and of the list version.
 * - It never changes plan rows, the Order's T&A fields, plan statuses or any validation.
 * - Optimistic locking: the page sends the `version` it loaded (none before the first save).
 */

type AuthUser = Request['user'];

interface GuideInput {
  yesIds: unknown;
  dates: GuideDates;
  version?: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const invalid = (message: string): HttpError => new HttpError(400, message, 'INVALID');

/** The order fields read for a save: its T&A values. */
const TNA_PROJECTION: Record<string, 1> = Object.fromEntries([['orderNo', 1], ...TNA_KEYS.map((key) => [key, 1])]);

/** The body's dates (each '' or a real 'YYYY-MM-DD' day) and version; `yesIds` is checked later, against the list. */
function parseBody(body: unknown): GuideInput {
  if (!isPlainObject(body)) throw invalid('Invalid Planning Guide data.');
  if (!isPlainObject(body.dates)) throw invalid('dates: the guide dates are required.');
  const dates = {} as GuideDates;
  for (const key of GUIDE_DATE_KEYS) {
    const value = body.dates[key];
    if (value !== '' && !isIsoDay(value)) throw invalid(`dates.${key}: must be empty or a date (YYYY-MM-DD).`);
    dates[key] = value;
  }
  let version: number | undefined;
  if (body.version !== undefined && body.version !== null) {
    if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1) {
      throw invalid('version: must be the version of the guide you loaded.');
    }
    version = body.version;
  }
  return { yesIds: body.yesIds, dates, version };
}

/**
 * The Yes ids, unique, each an Active criterion of the current list or already Yes on the stored guide (so a guide
 * keeps a criterion that was made Inactive or removed until someone sets it to No; it no longer counts in the lead).
 */
function checkYesIds(yesIds: unknown, checks: IGuideCheck[], storedYesIds: string[]): string[] {
  if (!Array.isArray(yesIds)) throw invalid('yesIds: the list of checkpoints set to Yes is required.');
  const byId = new Map(checks.map((check) => [check.id, check]));
  const storedYes = new Set(storedYesIds);
  const seen = new Set<string>();
  for (const id of yesIds) {
    if (typeof id !== 'string' || id === '') throw invalid('yesIds: each entry must be a checkpoint id.');
    const check = byId.get(id);
    const label = check?.name || id;
    if (seen.has(id)) throw invalid(`Checkpoint "${label}" is set to Yes more than once.`);
    seen.add(id);
    if (check?.active === true || storedYes.has(id)) continue;
    throw invalid(
      check
        ? `Checkpoint "${label}" is inactive in the Plan Check List, so it cannot be set to Yes.`
        : `Checkpoint "${label}" is not in the Plan Check List.`
    );
  }
  return yesIds as string[];
}

/**
 * The Plan Check List snapshot stored with the guide: the current list, plus (as inactive) any Yes criterion the list
 * no longer has, copied from the previous snapshot so its name stays known.
 */
function checksSnapshot(current: IGuideCheck[], yesIds: string[], previous: IGuideCheck[]): IGuideCheck[] {
  const snapshot = current.map(({ id, name, startDays, endDays, active }) => ({ id, name, startDays, endDays, active }));
  const inList = new Set(snapshot.map((check) => check.id));
  for (const id of yesIds) {
    if (inList.has(id)) continue;
    const old = previous.find((check) => check?.id === id);
    if (old) snapshot.push({ id, name: old.name, startDays: old.startDays, endDays: old.endDays, active: false });
  }
  return snapshot;
}

/** The order's T&A values as stored on the Order ('' when absent). */
function tnaSnapshot(order: Record<string, unknown>): IGuideTna {
  const tna = {} as IGuideTna;
  for (const key of TNA_KEYS) {
    const value = order[key];
    tna[key] = value === undefined || value === null ? '' : String(value);
  }
  return tna;
}

async function conflictError(orderNo: string): Promise<HttpError> {
  const latest = await OrderPlanGuide.findById(orderNo, { updatedBy: 1, updatedAt: 1 }).lean();
  const who = latest?.updatedBy || 'another user';
  const when = formatDhakaDateTime(latest?.updatedAt);
  return new HttpError(
    409,
    `The Planning Guide of this order was changed by ${who}${when ? ` at ${when}` : ''}. Reload the page to see the latest values.`,
    'CONFLICT'
  );
}

export class PlanGuideService {
  /**
   * Saves the guide and returns it as stored. Throws HttpError 404 (unknown order), 400 (code INVALID) or 409
   * (code CONFLICT: the guide was saved by someone else since the page loaded it); nothing is written then.
   */
  static async save(user: AuthUser, orderNo: string, body: unknown): Promise<IOrderPlanGuide> {
    const order = (await Order.findOne({ orderNo }, TNA_PROJECTION).lean()) as Record<string, unknown> | null;
    if (!order) throw new HttpError(404, `Order "${orderNo}" not found.`);

    const input = parseBody(body);
    const [stored, list] = await Promise.all([OrderPlanGuide.findById(orderNo).lean(), PlanCheckListService.current()]);

    // A page that loaded another version (or no guide at all) must reload first.
    if (stored && input.version !== stored.version) throw await conflictError(orderNo);

    const yesIds = checkYesIds(input.yesIds, list.items, stored?.yesIds || []);
    const fields = {
      orderNo,
      yesIds,
      dates: input.dates,
      lead: computeLead(list.items, yesIds),
      checks: checksSnapshot(list.items, yesIds, stored?.checks || []),
      tna: tnaSnapshot(order),
      checklistVersion: list.version,
      updatedBy: user?.username || '',
    };

    let saved: IOrderPlanGuide | null;
    if (stored) {
      // Matches only while the guide is still at the version the page loaded (equal to stored.version here).
      saved = await OrderPlanGuide.findOneAndUpdate(
        { _id: orderNo, version: input.version },
        { $set: fields, $inc: { version: 1 } },
        { returnDocument: 'after' }
      ).lean();
      if (!saved) throw await conflictError(orderNo);
    } else {
      try {
        saved = (await OrderPlanGuide.create({ _id: orderNo, ...fields, version: 1 })).toObject();
      } catch (error: any) {
        // Another first save of this order's guide got in first.
        if (error?.code === 11000) throw await conflictError(orderNo);
        throw error;
      }
    }

    OrderService.clearOrderDetailCache(orderNo);
    return saved;
  }
}
