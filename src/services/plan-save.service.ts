import { z } from 'zod';
import { Order } from '../models/Order.model.js';
import { OrderDate } from '../models/OrderDate.model.js';
import { HttpError } from '../utils/http-error.js';
import {
  PLAN_DEPTS,
  PlanDept,
  UNSAVED_FINGERPRINT,
  fingerprintAllDepts,
  fingerprintDept,
  isUnsavedDept,
} from '../utils/plan-fingerprint.js';
import { OrderService } from './order.service.js';
import { StatusEngineService } from './status-engine.service.js';

/**
 * POST /api/orders/save-plans: saves one or more departments' plans of one order in a single request (the
 * universal order page's section Saves and "Save Data").
 *
 * - Each department is stored exactly as save-dates stores it (OrderService.buildDeptSet), and every department of
 *   the request is written in ONE update of the order's OrderDate document, so they are saved together or not at all.
 * - Plan statuses follow the save-dates rule (StatusEngineService.computeSaveStatus), written in one Order update.
 * - `base` turns on a conflict check: a department whose saved plan changed since the page loaded it (another user,
 *   V2 or a file upload) is refused with 409 CONFLICT, unless it already holds exactly what this save writes.
 * - The planning rules themselves stay in the browser, as for save-dates; this endpoint adds no permission check.
 */

const DEPT_LABELS: Record<PlanDept, string> = {
  yd: 'YD',
  knitting: 'Knitting',
  dyeing: 'Dyeing',
  finishing: 'Finishing',
  delivery: 'Delivery',
};

/** Write attempts when the document keeps changing between the conflict check and the write. */
const MAX_WRITE_ATTEMPTS = 3;

const isObject = (value: unknown): boolean => value !== null && typeof value === 'object' && !Array.isArray(value);

const planSchema = z.object({
  department: z.enum(PLAN_DEPTS),
  fabricItems: z
    .array(z.unknown())
    .min(1, 'At least one item is required.')
    .superRefine((items, ctx) => {
      const index = items.findIndex((item) => !isObject(item));
      if (index >= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: 'Each item must be an object.' });
    }),
  orderStatus: z.string().optional(),
  completedDate: z.string().optional(),
});

const bodySchema = z.object({
  orderNo: z.string().refine((value) => value.trim() !== '', 'The order number is required.'),
  plans: z
    .array(planSchema)
    .min(1, 'At least one department is required.')
    .max(PLAN_DEPTS.length)
    .superRefine((plans, ctx) => {
      const seen = new Set<string>();
      plans.forEach((plan, index) => {
        if (seen.has(plan.department)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'department'], message: 'Each department may appear only once.' });
        }
        seen.add(plan.department);
      });
    }),
  base: z.record(z.enum(PLAN_DEPTS), z.string()).optional(),
});

type SavePlansBody = z.infer<typeof bodySchema>;
type PlanEntry = SavePlansBody['plans'][number];
type Base = Partial<Record<PlanDept, string>>;

export interface SavePlansResult {
  message: string;
  /** The order's OrderDate after the save (lean). */
  planData: Record<string, any> | null;
  /** The plan status written for each saved department. */
  planStatuses: Partial<Record<PlanDept, string>>;
  /** False when the plans were saved but the plan statuses could not be written (they refresh at the next save or upload). */
  statusSynced: boolean;
  /** Fingerprints of all five departments in `planData`. */
  fingerprints: Record<PlanDept, string>;
}

const invalid = (message: string): HttpError => new HttpError(400, message, 'INVALID');

function parseBody(body: unknown): SavePlansBody {
  // Refuse an oversized plans list before zod parses every element of it.
  const plans = isObject(body) ? (body as Record<string, unknown>).plans : undefined;
  if (Array.isArray(plans) && plans.length > PLAN_DEPTS.length) {
    throw invalid(`plans: at most ${PLAN_DEPTS.length} departments can be saved at once.`);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalid(issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message);
  }
  return parsed.data;
}

function listNames(departments: PlanDept[]): string {
  const names = departments.map((d) => DEPT_LABELS[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}

function conflictError(departments: PlanDept[]): HttpError {
  const verb = departments.length > 1 ? 'were' : 'was';
  return new HttpError(
    409,
    `${listNames(departments)} ${verb} changed by someone else after this order was opened.`,
    'CONFLICT',
    { departments }
  );
}

/**
 * The departments of `plans` whose stored plan changed since the page read it (its fingerprint is no longer `base`)
 * and does not already equal what this save writes. A department that was never saved still counts as unchanged when
 * the page saw no OrderDate at all (the document may have been created meanwhile by another department's save).
 */
function changedDepartments(
  stored: Record<string, any> | null,
  plans: PlanEntry[],
  base: Base,
  set: Record<string, unknown>
): PlanDept[] {
  const changed = new Set<PlanDept>();
  for (const { department } of plans) {
    const expected = base[department];
    const storedFingerprint = fingerprintDept(stored, department);
    if (storedFingerprint === expected) continue;
    if (expected === UNSAVED_FINGERPRINT && isUnsavedDept(stored, department)) continue;
    // The department as this save would store it (the status stays as stored when none is sent).
    if (storedFingerprint === fingerprintDept({ ...stored, ...set }, department)) continue;
    changed.add(department);
  }
  return PLAN_DEPTS.filter((d) => changed.has(d));
}

const isDuplicateKey = (error: any): boolean => error?.code === 11000;

/** save-dates' write: one $set, creating the OrderDate when the order has none. */
async function writeWithoutCheck(orderNo: string, set: Record<string, unknown>): Promise<Record<string, any> | null> {
  return OrderDate.findOneAndUpdate({ orderNo }, { $set: set }, { returnDocument: 'after', upsert: true }).lean();
}

/**
 * The write with the conflict check for the departments that have a `base`. The update matches the document only
 * while its updatedAt is still the value the check read (no upsert with that filter); when another save got in
 * between, the document is read again and only the requested departments are checked again.
 */
async function writeWithCheck(
  orderNo: string,
  set: Record<string, unknown>,
  checked: PlanEntry[],
  base: Base
): Promise<Record<string, any> | null> {
  const projection: Record<string, 1> = { updatedAt: 1 };
  for (const { department } of checked) {
    projection[department] = 1;
    projection[`${department}Status`] = 1;
  }
  const read = () => OrderDate.findOne({ orderNo }, projection).lean() as Promise<Record<string, any> | null>;

  let stored = await read();
  for (let attempt = 1; ; attempt++) {
    const changed = changedDepartments(stored, checked, base, set);
    if (changed.length) throw conflictError(changed);

    if (!stored) {
      try {
        await OrderDate.create({ orderNo, ...set });
        return (await OrderDate.findOne({ orderNo }).lean()) as Record<string, any> | null;
      } catch (error) {
        // Another save created the document first: check against it and update it instead.
        if (!isDuplicateKey(error)) throw error;
      }
    } else {
      const updated = await OrderDate.findOneAndUpdate(
        { orderNo, updatedAt: stored.updatedAt ?? null },
        { $set: set },
        { upsert: false, returnDocument: 'after' }
      ).lean();
      if (updated) return updated as Record<string, any>;
    }

    if (attempt >= MAX_WRITE_ATTEMPTS) {
      throw new HttpError(500, 'The order kept changing while it was being saved. Nothing was saved; please save again.');
    }
    stored = await read();
  }
}

/** Runs a write, and once more if it fails. */
async function withOneRetry(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch {
    try {
      await write();
      return true;
    } catch (error: any) {
      console.warn('save-plans: plan status write failed:', error?.message);
      return false;
    }
  }
}

export class PlanSaveService {
  /**
   * Validates and saves the request. Throws HttpError 400 (code INVALID), 404 (no such order) or 409 (code CONFLICT,
   * with `departments`); nothing is written in those cases.
   */
  static async savePlans(body: unknown): Promise<SavePlansResult> {
    const { orderNo, plans, base = {} } = parseBody(body);

    if (!(await Order.exists({ orderNo }))) {
      throw new HttpError(404, `Order "${orderNo}" not found.`);
    }

    // One $set for every department of the request.
    const set: Record<string, unknown> = {};
    for (const plan of plans) {
      Object.assign(set, OrderService.buildDeptSet(plan.department, plan.fabricItems, plan.orderStatus, plan.completedDate));
    }

    const checked = plans.filter((plan) => base[plan.department] !== undefined);
    const planData = checked.length
      ? await writeWithCheck(orderNo, set, checked, base)
      : await writeWithoutCheck(orderNo, set);

    const planStatuses: Partial<Record<PlanDept, string>> = {};
    const statusSet: Record<string, string> = {};
    for (const plan of plans) {
      const status = StatusEngineService.computeSaveStatus(plan.department, plan.fabricItems, plan.orderStatus);
      planStatuses[plan.department] = status;
      statusSet[`${plan.department}PlanStatus`] = status;
    }
    const statusSynced = await withOneRetry(() => Order.updateOne({ orderNo }, { $set: statusSet }));

    OrderService.clearReportCache();

    return {
      message: 'Planning Data saved successfully!',
      planData,
      planStatuses,
      statusSynced,
      fingerprints: fingerprintAllDepts(planData),
    };
  }
}
