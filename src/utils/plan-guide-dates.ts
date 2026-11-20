/**
 * Dates and lead time of the order page's Checkpoint & Planning Guide (decisions D10 and D11).
 *
 * Plain TypeScript with no framework or database code: the client keeps a copy of these rules
 * (src/features/planning/lib/plan-guide.ts), and both must give the same results.
 *
 * Dates are 'YYYY-MM-DD' strings. Parsing is strict (never `new Date(text)`), and days are added as calendar days in
 * UTC (Date.UTC + setUTCDate), so every time zone gives the same day.
 */

/** The guide's rows, top to bottom. */
export const GUIDE_ROWS = ['yd', 'knit', 'dye', 'floor', 'lock'] as const;
export type GuideRow = (typeof GUIDE_ROWS)[number];

/** The ten date cells, `<row>Start` and `<row>End`. */
export const GUIDE_DATE_KEYS = [
  'ydStart',
  'ydEnd',
  'knitStart',
  'knitEnd',
  'dyeStart',
  'dyeEnd',
  'floorStart',
  'floorEnd',
  'lockStart',
  'lockEnd',
] as const;
export type GuideDateKey = (typeof GUIDE_DATE_KEYS)[number];
export type GuideDates = Record<GuideDateKey, string>;

/** The Order's General-file T&A fields the guide starts from. */
export const TNA_KEYS = ['yarnDate', 'knitStart', 'knitEnd', 'dyeStart', 'dyeEnd', 'deliStart', 'deliEnd'] as const;
export type TnaKey = (typeof TNA_KEYS)[number];

/** A Plan Check List criterion. */
export interface PlanCheck {
  id: string;
  name: string;
  startDays: number;
  endDays: number;
  active: boolean;
}

/**
 * The checklist lead time on the Knit row: the largest startDays and, separately, the largest endDays of the Active
 * criteria set to Yes (per-column maxima, never sums). `startFrom` / `endFrom` name the criteria that hold each
 * maximum, in Plan Check List order, and `startFromIds` / `endFromIds` are their ids in the same order (a criterion
 * can be renamed later; its id stays).
 */
export interface GuideLead {
  startDays: number;
  endDays: number;
  startFrom: string[];
  endFrom: string[];
  startFromIds: string[];
  endFromIds: string[];
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER_TEXT = /^\d+(\.\d+)?$/;
/**
 * An Excel date serial is accepted exactly as the uploads accept it (src/utils/excel-date.ts, `val > 25000 &&
 * val < 70000`): greater than 25000 and less than 70000, so 25000 and 70000 themselves are not dates.
 */
const EXCEL_SERIAL_ABOVE = 25000;
const EXCEL_SERIAL_BELOW = 70000;
/** Excel serial of 1970-01-01. */
const EXCEL_UNIX_EPOCH = 25569;
const DAY_MS = 86400 * 1000;

function excelSerialToIsoDay(serial: number): string {
  if (!Number.isFinite(serial) || !(serial > EXCEL_SERIAL_ABOVE && serial < EXCEL_SERIAL_BELOW)) return '';
  return new Date(Math.round((serial - EXCEL_UNIX_EPOCH) * DAY_MS)).toISOString().slice(0, 10);
}

/**
 * A T&A or guide value as 'YYYY-MM-DD', or '' when it is not a date:
 * - a 'YYYY-MM-DD' string of a real calendar day is returned as it is ('2026-02-30' is not one);
 * - an Excel date serial greater than 25000 and less than 70000, as a number or a numeric string ('46297',
 *   '46297.5'), is converted as the uploads convert it: 25001 gives '1968-06-12' and 69999 gives '2091-08-24';
 * - anything else ('', '-', 'N/A', 'TBA', '10/02/2026', 25000, '70000', null, ...) gives ''.
 */
export function toIsoDay(value: unknown): string {
  if (typeof value === 'number') return excelSerialToIsoDay(value);
  if (typeof value !== 'string') return '';
  const match = ISO_DAY.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    const sameDay = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    return sameDay ? value : '';
  }
  return NUMBER_TEXT.test(value) ? excelSerialToIsoDay(Number(value)) : '';
}

/** True for a 'YYYY-MM-DD' string of a real calendar day. */
export function isIsoDay(value: unknown): value is string {
  return typeof value === 'string' && ISO_DAY.test(value) && toIsoDay(value) === value;
}

/** Whole days to add: a finite number, cut to an integer; anything else is 0. */
const wholeDays = (days: unknown): number => (typeof days === 'number' && Number.isFinite(days) ? Math.trunc(days) : 0);

/**
 * `iso` plus `days` calendar days, as 'YYYY-MM-DD'. Anything that is not a 'YYYY-MM-DD' date ('' included) gives '',
 * so a missing or invalid T&A value is never shifted.
 */
export function addDaysIso(iso: string, days: number): string {
  if (!isIsoDay(iso)) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + wholeDays(days));
  if (!Number.isFinite(date.getTime())) return '';
  const result = date.toISOString().slice(0, 10);
  return ISO_DAY.test(result) ? result : '';
}

/** Lead days of a criterion: a positive whole number of days, else 0. */
const leadDays = (days: unknown): number => Math.max(0, wholeDays(days));

/**
 * The lead time (D10): over the criteria that are Yes AND Active, the largest startDays and, separately, the largest
 * endDays. Unknown, removed and inactive ids are ignored; with no such criteria the lead is 0/0.
 * Example: A 10/3 and B 8/7 both Yes gives +10 / +7 (startFrom ['A'], endFrom ['B']).
 */
export function computeLead(
  checks: readonly PlanCheck[] | null | undefined,
  yesIds: readonly string[] | null | undefined
): GuideLead {
  const yes = new Set(Array.isArray(yesIds) ? yesIds : []);
  const counted = (Array.isArray(checks) ? checks : []).filter(
    (check) => !!check && check.active === true && yes.has(check.id)
  );
  const startDays = counted.reduce((max, check) => Math.max(max, leadDays(check.startDays)), 0);
  const endDays = counted.reduce((max, check) => Math.max(max, leadDays(check.endDays)), 0);
  const startHolders = counted.filter((check) => leadDays(check.startDays) === startDays);
  const endHolders = counted.filter((check) => leadDays(check.endDays) === endDays);
  return {
    startDays,
    endDays,
    startFrom: startHolders.map((check) => check.name),
    endFrom: endHolders.map((check) => check.name),
    startFromIds: startHolders.map((check) => check.id),
    endFromIds: endHolders.map((check) => check.id),
  };
}

/**
 * The guide's dates computed from the Order's T&A and the lead (D11). Also works on a guide's `tna` snapshot, which
 * has the same fields.
 * - YD: Start = T&A Yarn date, End blank.
 * - Knit: T&A Knitting Start + lead.startDays, T&A Knitting End + lead.endDays.
 * - Dye: T&A Dyeing Start / End. Floor: T&A Deli. Start / End. Lock: blank.
 * A T&A value that is not a date gives a blank cell and is never shifted.
 */
export function computeGuideDefaults(
  order: Partial<Record<TnaKey, unknown>> | null | undefined,
  lead?: Partial<Pick<GuideLead, 'startDays' | 'endDays'>> | null
): GuideDates {
  const tna = order || {};
  return {
    ydStart: toIsoDay(tna.yarnDate),
    ydEnd: '',
    knitStart: addDaysIso(toIsoDay(tna.knitStart), leadDays(lead?.startDays)),
    knitEnd: addDaysIso(toIsoDay(tna.knitEnd), leadDays(lead?.endDays)),
    dyeStart: toIsoDay(tna.dyeStart),
    dyeEnd: toIsoDay(tna.dyeEnd),
    floorStart: toIsoDay(tna.deliStart),
    floorEnd: toIsoDay(tna.deliEnd),
    lockStart: '',
    lockEnd: '',
  };
}

const startKey = (row: GuideRow): GuideDateKey => `${row}Start`;
const endKey = (row: GuideRow): GuideDateKey => `${row}End`;
const cellText = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The rows (in guide order) whose Start or End differs between two sets of guide dates, e.g. the dates stored with a
 * guide and the dates computed now from the T&A and the current lead. A missing cell counts as ''.
 */
export function guideRowsChanged(
  stored: Partial<Record<GuideDateKey, unknown>> | null | undefined,
  live: Partial<Record<GuideDateKey, unknown>> | null | undefined
): GuideRow[] {
  const a = stored || {};
  const b = live || {};
  return GUIDE_ROWS.filter(
    (row) =>
      cellText(a[startKey(row)]) !== cellText(b[startKey(row)]) || cellText(a[endKey(row)]) !== cellText(b[endKey(row)])
  );
}
