import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLAN_CHECK_LIST_DEFAULTS } from '../src/constants/plan-check-list-defaults.js';
import {
  GUIDE_DATE_KEYS,
  addDaysIso,
  computeGuideDefaults,
  computeLead,
  guideRowsChanged,
  isIsoDay,
  toIsoDay,
  type PlanCheck,
} from '../src/utils/plan-guide-dates.js';

/**
 * src/utils/plan-guide-dates.ts (S3): strict date parsing, calendar-day shifts, the lead rule (D10, per-column
 * maxima) and the guide's default dates (D11). The date rules run under three server time zones; the process time
 * zone is switched at run time and each block first proves the switch took effect.
 */

const ZONES: { tz: string; offsets: [number, number] }[] = [
  { tz: 'UTC', offsets: [0, 0] },
  { tz: 'Asia/Dhaka', offsets: [-360, -360] },
  { tz: 'America/New_York', offsets: [300, 240] }, // daylight saving in July
];

const D9 = PLAN_CHECK_LIST_DEFAULTS.map((item) => ({ ...item }));
const crit = (id: string, startDays: number, endDays: number, active = true): PlanCheck => ({ id, name: id, startDays, endDays, active });

/** The user's example order: T&A Knitting 2 to 21 October 2026. */
const ORDER = {
  yarnDate: '2026-09-28',
  knitStart: '2026-10-02',
  knitEnd: '2026-10-21',
  dyeStart: '2026-10-15',
  dyeEnd: '2026-10-30',
  deliStart: '2026-11-02',
  deliEnd: '2026-11-12',
};

describe.each(ZONES)('dates with TZ=$tz', ({ tz, offsets }) => {
  let original: string | undefined;
  beforeAll(() => {
    original = process.env.TZ;
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('runs in that time zone', () => {
    expect([new Date(2026, 0, 15).getTimezoneOffset(), new Date(2026, 6, 15).getTimezoneOffset()]).toEqual(offsets);
  });

  it('addDaysIso adds calendar days (SPEC cases)', () => {
    expect(addDaysIso('2026-10-02', 10)).toBe('2026-10-12');
    expect(addDaysIso('2026-10-21', 7)).toBe('2026-10-28');
    expect(addDaysIso('2026-12-28', 10)).toBe('2027-01-07');
    expect(addDaysIso('2028-02-25', 5)).toBe('2028-03-01'); // 2028 is a leap year
    expect(addDaysIso('2026-02-25', 5)).toBe('2026-03-02');
    expect(addDaysIso('2026-10-12', 0)).toBe('2026-10-12');
    expect(addDaysIso('2026-01-05', -7)).toBe('2025-12-29');
  });

  it('addDaysIso is not moved by daylight-saving changes', () => {
    // US clocks change on 2026-03-08 and 2026-11-01; `new Date(iso)` + setDate gives the wrong day in New York.
    expect(addDaysIso('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDaysIso('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysIso('2026-03-01', 10)).toBe('2026-03-11');
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysIso('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDaysIso('2026-10-25', 12)).toBe('2026-11-06');
  });

  it('addDaysIso never shifts a value that is not a date', () => {
    for (const bad of ['', 'TBA', '-', 'N/A', '2026-02-30', '46297', '10/02/2026', ' 2026-10-02']) {
      expect(addDaysIso(bad, 10), bad).toBe('');
    }
    expect(addDaysIso('2026-10-02', Number.NaN)).toBe('2026-10-02');
  });

  it("toIsoDay keeps real 'YYYY-MM-DD' days only", () => {
    expect(toIsoDay('2026-10-02')).toBe('2026-10-02');
    expect(toIsoDay('2028-02-29')).toBe('2028-02-29');
    expect(toIsoDay('2026-02-30')).toBe('');
    expect(toIsoDay('2026-02-29')).toBe('');
    expect(toIsoDay('2026-13-01')).toBe('');
    expect(toIsoDay('2026-00-10')).toBe('');
    expect(toIsoDay('2026-10-32')).toBe('');
    for (const bad of ['', '-', 'N/A', 'TBA', '—', '10/02/2026', '02-Oct-2026', '2026-10-02T00:00:00Z', ' 2026-10-02', '2026-1-2']) {
      expect(toIsoDay(bad), bad).toBe('');
    }
    for (const bad of [null, undefined, true, {}, [], new Date('2026-10-02')]) {
      expect(toIsoDay(bad)).toBe('');
    }
  });

  it('toIsoDay converts Excel date serials (number or numeric text) from 25000 to 70000', () => {
    expect(toIsoDay(46297)).toBe('2026-10-02');
    expect(toIsoDay('46297')).toBe('2026-10-02');
    expect(toIsoDay(46297.75)).toBe('2026-10-02'); // a serial with a time of day
    expect(toIsoDay(45658)).toBe('2025-01-01');
    expect(toIsoDay(25000)).toBe('1968-06-11');
    expect(toIsoDay(70000)).toBe('2091-08-25');
    expect(toIsoDay(24999)).toBe('');
    expect(toIsoDay(70001)).toBe('');
    expect(toIsoDay(45)).toBe('');
    expect(toIsoDay('45')).toBe('');
    expect(toIsoDay(Number.NaN)).toBe('');
  });

  it("gives the user's example: T&A 2026-10-02..2026-10-21 + Heatset (10/7) = 2026-10-12..2026-10-28", () => {
    const lead = computeLead(D9, ['heatset']);
    expect(lead).toEqual({ startDays: 10, endDays: 7, startFrom: ['Heatset'], endFrom: ['Heatset'] });
    expect(computeGuideDefaults(ORDER, lead)).toEqual({
      ydStart: '2026-09-28',
      ydEnd: '',
      knitStart: '2026-10-12',
      knitEnd: '2026-10-28',
      dyeStart: '2026-10-15',
      dyeEnd: '2026-10-30',
      floorStart: '2026-11-02',
      floorEnd: '2026-11-12',
      lockStart: '',
      lockEnd: '',
    });
  });

  it("leaves 'TBA', '-' and other non-dates blank and unshifted", () => {
    const dates = computeGuideDefaults(
      { yarnDate: 'TBA', knitStart: 'TBA', knitEnd: '-', dyeStart: '', dyeEnd: 'N/A', deliStart: '2026-02-30', deliEnd: '2026-11-12' },
      { startDays: 10, endDays: 7 }
    );
    expect(dates).toEqual({
      ydStart: '',
      ydEnd: '',
      knitStart: '',
      knitEnd: '',
      dyeStart: '',
      dyeEnd: '',
      floorStart: '',
      floorEnd: '2026-11-12',
      lockStart: '',
      lockEnd: '',
    });
    // One side missing: the other side is still shifted.
    expect(computeGuideDefaults({ knitStart: '', knitEnd: '2026-10-21' }, { startDays: 10, endDays: 7 }).knitEnd).toBe('2026-10-28');
  });
});

describe('computeLead (D10: per-column maxima)', () => {
  it('none: 0/0', () => {
    expect(computeLead(D9, [])).toEqual({ startDays: 0, endDays: 0, startFrom: [], endFrom: [] });
    expect(computeLead(D9, null)).toEqual({ startDays: 0, endDays: 0, startFrom: [], endFrom: [] });
    expect(computeLead(null, ['heatset'])).toEqual({ startDays: 0, endDays: 0, startFrom: [], endFrom: [] });
  });

  it('one', () => {
    expect(computeLead(D9, ['singeing'])).toEqual({ startDays: 7, endDays: 7, startFrom: ['Singeing'], endFrom: ['Singeing'] });
  });

  it('A 10/3 + B 8/7 gives +10/+7: start from A, end from B (never the sum)', () => {
    expect(computeLead([crit('A', 10, 3), crit('B', 8, 7)], ['A', 'B'])).toEqual({
      startDays: 10,
      endDays: 7,
      startFrom: ['A'],
      endFrom: ['B'],
    });
  });

  it('Heatset 10/7 + CPB 12/9 gives 12/9', () => {
    expect(computeLead(D9, ['heatset', 'cpb'])).toEqual({ startDays: 12, endDays: 9, startFrom: ['CPB'], endFrom: ['CPB'] });
  });

  it('several, with ties: every criterion holding a maximum is named, in list order', () => {
    expect(computeLead(D9, ['singeing', 'heatset'])).toEqual({
      startDays: 10,
      endDays: 7,
      startFrom: ['Heatset'],
      endFrom: ['Heatset', 'Singeing'],
    });
    expect(computeLead(D9, ['yd_post', 'yd_pre'])).toEqual({ startDays: 6, endDays: 4, startFrom: ['YD Pre', 'YD Post'], endFrom: ['YD Pre', 'YD Post'] });
    expect(computeLead(D9, D9.map((item) => item.id))).toEqual({
      startDays: 12,
      endDays: 9,
      startFrom: ['CPB'],
      endFrom: ['CPB', 'Mercerized'],
    });
  });

  it('a Yes criterion of 0/0 alone gives 0/0 and holds both maxima', () => {
    expect(computeLead(D9, ['peach_brush'])).toEqual({ startDays: 0, endDays: 0, startFrom: ['Peach/brush'], endFrom: ['Peach/brush'] });
  });

  it('ignores inactive, unknown, removed and repeated ids', () => {
    const list = D9.map((item) => (item.id === 'cpb' ? { ...item, active: false } : item));
    expect(computeLead(list, ['cpb', 'heatset', 'no_such_id', 'heatset'])).toEqual({
      startDays: 10,
      endDays: 7,
      startFrom: ['Heatset'],
      endFrom: ['Heatset'],
    });
    expect(computeLead(list, ['cpb'])).toEqual({ startDays: 0, endDays: 0, startFrom: [], endFrom: [] });
    // active must be exactly true
    expect(computeLead([{ ...crit('X', 5, 5), active: 'true' as unknown as boolean }], ['X']).startDays).toBe(0);
  });

  it('is the lead shown in the badge for the D10 example', () => {
    const lead = computeLead([crit('A', 10, 3), crit('B', 8, 7)], ['B', 'A']);
    expect(`+${lead.startDays}d / +${lead.endDays}d Checklist Lead Time`).toBe('+10d / +7d Checklist Lead Time');
  });
});

describe('computeGuideDefaults (D11)', () => {
  it('without a lead the T&A is used as it is, and YD End and Lock are blank', () => {
    const dates = computeGuideDefaults(ORDER);
    expect(dates.knitStart).toBe('2026-10-02');
    expect(dates.knitEnd).toBe('2026-10-21');
    expect([dates.ydEnd, dates.lockStart, dates.lockEnd]).toEqual(['', '', '']);
    expect(Object.keys(dates)).toEqual([...GUIDE_DATE_KEYS]);
  });

  it('may give Knit Start after Knit End (shown as a warning only)', () => {
    const dates = computeGuideDefaults({ knitStart: '2026-10-02', knitEnd: '2026-10-04' }, computeLead(D9, ['cpb']));
    expect([dates.knitStart, dates.knitEnd]).toEqual(['2026-10-14', '2026-10-13']);
  });

  it('reads Excel serials in the T&A, and works on a missing order', () => {
    expect(computeGuideDefaults({ knitStart: 46297 }, { startDays: 10 }).knitStart).toBe('2026-10-12');
    expect(computeGuideDefaults(null)).toEqual(Object.fromEntries(GUIDE_DATE_KEYS.map((key) => [key, ''])));
  });
});

describe('guideRowsChanged', () => {
  const live = computeGuideDefaults(ORDER, { startDays: 10, endDays: 7 });

  it('reports the rows whose Start or End differs, in guide order', () => {
    expect(guideRowsChanged(live, { ...live })).toEqual([]);
    expect(guideRowsChanged({ ...live, knitEnd: '2026-10-21' }, live)).toEqual(['knit']);
    expect(guideRowsChanged({ ...live, lockStart: '2026-11-20', ydStart: '' }, live)).toEqual(['yd', 'lock']);
  });

  it('treats a missing cell as blank', () => {
    const { ydEnd, lockStart, lockEnd, ...rest } = live;
    expect([ydEnd, lockStart, lockEnd]).toEqual(['', '', '']);
    expect(guideRowsChanged(rest, live)).toEqual([]);
    expect(guideRowsChanged(null, undefined)).toEqual([]);
    expect(guideRowsChanged(null, live)).toEqual(['yd', 'knit', 'dye', 'floor']);
  });

  it('compares the stored T&A basis with the current one (a changed T&A shows on its row only)', () => {
    const atSave = computeGuideDefaults(ORDER, { startDays: 10, endDays: 7 });
    const now = computeGuideDefaults({ ...ORDER, dyeEnd: '2026-11-01' }, { startDays: 12, endDays: 9 });
    expect(guideRowsChanged(atSave, now)).toEqual(['knit', 'dye']);
  });
});

describe('isIsoDay', () => {
  it("is true only for a real 'YYYY-MM-DD' day", () => {
    expect(isIsoDay('2026-10-02')).toBe(true);
    for (const bad of ['', '2026-02-30', '46297', 46297, null, 'TBA']) expect(isIsoDay(bad)).toBe(false);
  });
});
