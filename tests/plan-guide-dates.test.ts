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
 * src/utils/plan-guide-dates.ts (S3): strict date parsing, calendar-day shifts, the lead rule (D10, both values of the
 * one largest Yes criterion) and the guide's default dates (D11). The date rules run under three server time zones; the process time
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
    expect(lead).toEqual({
      startDays: 10,
      endDays: 7,
      startFrom: ['Heatset'],
      endFrom: ['Heatset'],
      startFromIds: ['heatset'],
      endFromIds: ['heatset'],
    });
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

describe('computeLead (D10: both values of the one largest criterion)', () => {
  const NONE = { startDays: 0, endDays: 0, startFrom: [], endFrom: [], startFromIds: [], endFromIds: [] };
  /** The lead taken from one chosen criterion: its two values, and its name and id on both sides. */
  const fromOne = (id: string, name: string, startDays: number, endDays: number) => ({
    startDays,
    endDays,
    startFrom: [name],
    endFrom: [name],
    startFromIds: [id],
    endFromIds: [id],
  });

  /** The rule written as a sort: most startDays, then most endDays, then list order; Active Yes criteria only. */
  const reference = (checks: PlanCheck[], yesIds: string[]) => {
    const best = checks
      .map((check, index) => ({ check, index }))
      .filter(({ check }) => check.active === true && yesIds.includes(check.id))
      .sort((a, b) => b.check.startDays - a.check.startDays || b.check.endDays - a.check.endDays || a.index - b.index)[0]?.check;
    return best ? fromOne(best.id, best.name, best.startDays, best.endDays) : NONE;
  };

  it('none: 0/0', () => {
    expect(computeLead(D9, [])).toEqual(NONE);
    expect(computeLead(D9, null)).toEqual(NONE);
    expect(computeLead(null, ['heatset'])).toEqual(NONE);
  });

  it('one', () => {
    expect(computeLead(D9, ['singeing'])).toEqual(fromOne('singeing', 'Singeing', 7, 7));
  });

  it("A 10/3 + B 8/7 gives +10/+3: both values of A, never B's end and never the sum", () => {
    expect(computeLead([crit('A', 10, 3), crit('B', 8, 7)], ['A', 'B'])).toEqual(fromOne('A', 'A', 10, 3));
    expect(computeLead([crit('B', 8, 7), crit('A', 10, 3)], ['B', 'A'])).toEqual(fromOne('A', 'A', 10, 3));
  });

  it('never takes the end from another criterion, however large it is', () => {
    expect(computeLead([crit('X', 5, 20), crit('Y', 6, 1)], ['X', 'Y'])).toEqual(fromOne('Y', 'Y', 6, 1));
  });

  it('Heatset 10/7 + CPB 12/9 gives 12/9', () => {
    expect(computeLead(D9, ['heatset', 'cpb'])).toEqual(fromOne('cpb', 'CPB', 12, 9));
  });

  it('several: the most start days wins, whatever the order of the Yes ids', () => {
    expect(computeLead(D9, ['singeing', 'heatset'])).toEqual(fromOne('heatset', 'Heatset', 10, 7));
    expect(computeLead(D9, D9.map((item) => item.id))).toEqual(fromOne('cpb', 'CPB', 12, 9));
    expect(computeLead(D9, [...D9].reverse().map((item) => item.id))).toEqual(fromOne('cpb', 'CPB', 12, 9));
  });

  it('ties: the same start days go to more end days, then to the first in the list', () => {
    // YD Pre (6/4) comes before Semibleach (6/5) in the list, but Semibleach has more end days.
    expect(computeLead(D9, ['yd_pre', 'semibleach'])).toEqual(fromOne('semibleach', 'Semibleach', 6, 5));
    // YD Pre and YD Post are both 6/4: the first in the list, whatever the order of the Yes ids.
    expect(computeLead(D9, ['yd_post', 'yd_pre'])).toEqual(fromOne('yd_pre', 'YD Pre', 6, 4));
    expect(computeLead([crit('P', 3, 3), crit('Q', 3, 3)], ['Q', 'P'])).toEqual(fromOne('P', 'P', 3, 3));
  });

  it('a Yes criterion of 0/0 gives 0/0 and is still named', () => {
    expect(computeLead(D9, ['peach_brush'])).toEqual(fromOne('peach_brush', 'Peach/brush', 0, 0));
    expect(computeLead(D9, ['subcontract', 'peach_brush'])).toEqual(fromOne('peach_brush', 'Peach/brush', 0, 0));
  });

  it('keeps the id when the name changes', () => {
    const renamed = D9.map((item) => (item.id === 'heatset' ? { ...item, name: 'Heat Set' } : item));
    expect(computeLead(renamed, ['heatset'])).toEqual(fromOne('heatset', 'Heat Set', 10, 7));
  });

  it('ignores inactive, unknown, removed and repeated ids', () => {
    const list = D9.map((item) => (item.id === 'cpb' ? { ...item, active: false } : item));
    // CPB (12/9) would be the largest, but it is inactive.
    expect(computeLead(list, ['cpb', 'heatset', 'no_such_id', 'heatset'])).toEqual(fromOne('heatset', 'Heatset', 10, 7));
    expect(computeLead(list, ['cpb'])).toEqual(NONE);
    // active must be exactly true
    expect(computeLead([{ ...crit('X', 5, 5), active: 'true' as unknown as boolean }], ['X']).startDays).toBe(0);
  });

  it('matches the rule written as a sort, for every Yes combination of the standard list', () => {
    for (let mask = 0; mask < 1 << D9.length; mask++) {
      const yesIds = D9.filter((_, index) => mask & (1 << index)).map((item) => item.id);
      expect(computeLead(D9, yesIds), yesIds.join(',')).toEqual(reference(D9, yesIds));
    }
  });

  it('matches the rule written as a sort, for edited lists with ties and inactive criteria', () => {
    // A fixed pseudo-random sequence (32-bit LCG, high bits), so every run checks the same 500 cases.
    let seed = 20261121;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
    for (let round = 0; round < 500; round++) {
      const list = Array.from({ length: 1 + next(7) }, (_, index) =>
        crit(`c${index}`, next(4) * 3, next(4) * 3, next(5) > 0)
      );
      const yesIds = list.filter(() => next(3) > 0).map((check) => check.id);
      if (next(4) === 0) yesIds.push('no_such_id');
      expect(computeLead(list, yesIds), JSON.stringify({ list, yesIds })).toEqual(reference(list, yesIds));
    }
  });

  it('is the lead shown in the badge for the D10 example', () => {
    const lead = computeLead([crit('A', 10, 3), crit('B', 8, 7)], ['B', 'A']);
    expect(`+${lead.startDays}d / +${lead.endDays}d Checklist Lead Time`).toBe('+10d / +3d Checklist Lead Time');
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
