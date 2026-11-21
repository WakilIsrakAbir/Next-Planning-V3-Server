import { createHash } from 'node:crypto';

/** The plan departments, in pipeline order. Each has `<dept>` rows and `<dept>Status` in the order's OrderDate. */
export const PLAN_DEPTS = ['yd', 'knitting', 'dyeing', 'finishing', 'delivery'] as const;
export type PlanDept = (typeof PLAN_DEPTS)[number];

/** The plan fields of a saved row, which the order page edits. */
const ITEM_FIELDS = [
  'itemId',
  'planType',
  'startDate',
  'endDate',
  'floorStartDate',
  'floorEndDate',
  'floorPlanType',
  'yarnDate',
  'yarnOkDate',
  'matchingOptionDate',
  'limitation',
  'remarks',
  'unit',
  'processName',
  'barrierQty',
  'workableQty',
] as const;

/**
 * The only itemData keys that people change (V2 saves them only inside itemData, and a file upload keeps them).
 * Every other itemData key is copied from the Excel file, so a quantity refresh by an upload does not count as a change.
 */
const ITEM_DATA_FIELDS = ['Unit', 'ProcessName', 'Process Name', 'Barrier Qty.', 'Workable Qty.'] as const;

const normalise = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

/**
 * Fingerprint of one department's saved plan in an OrderDate document (null when the order has none): the sha1 of a
 * deterministic JSON of its status and the plan fields of its rows. GET /api/orders/:orderNo returns it for every
 * department, and save-plans compares it with the `base` a page sends, to detect a save made in between by someone
 * else (another user, V2 or a file upload).
 */
export function fingerprintDept(planDoc: Record<string, any> | null | undefined, dept: string): string {
  const rows = planDoc?.[dept];
  const content = {
    status: normalise(planDoc?.[`${dept}Status`]),
    items: (Array.isArray(rows) ? rows : []).map((item: any) => {
      const fields: Record<string, string> = {};
      for (const key of ITEM_FIELDS) fields[key] = normalise(item?.[key]);
      for (const key of ITEM_DATA_FIELDS) fields[`itemData.${key}`] = normalise(item?.itemData?.[key]);
      return fields;
    }),
  };
  return createHash('sha1').update(JSON.stringify(content)).digest('hex');
}

/** Fingerprints of all five departments. */
export function fingerprintAllDepts(planDoc: Record<string, any> | null | undefined): Record<PlanDept, string> {
  const result = {} as Record<PlanDept, string>;
  for (const dept of PLAN_DEPTS) result[dept] = fingerprintDept(planDoc, dept);
  return result;
}

/** The fingerprint of a department when the order has no OrderDate yet (the same for every department). */
export const UNSAVED_FINGERPRINT = fingerprintDept(null, 'knitting');

/**
 * True when nothing was ever saved for the department: no rows, and its status is missing or the schema default
 * 'On Process'. The first save of any department creates the OrderDate with these defaults for the other departments;
 * for a page opened before that, those departments are still unchanged.
 */
export function isUnsavedDept(planDoc: Record<string, any> | null | undefined, dept: string): boolean {
  const rows = planDoc?.[dept];
  const status = planDoc?.[`${dept}Status`];
  const noRows = rows === undefined || rows === null || (Array.isArray(rows) && rows.length === 0);
  return noRows && (status === undefined || status === null || status === '' || status === 'On Process');
}
