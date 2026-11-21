import { describe, expect, it } from 'vitest';
import { PLAN_CHECK_LIST_DEFAULTS } from '../src/constants/plan-check-list-defaults.js';
import { computeLead, type GuideLead, type PlanCheck } from '../src/utils/plan-guide-dates.js';

/**
 * Safety net for the lead rule (SPEC D10, per-column maxima): computeLead must give exactly what a plain reference
 * gives, on the standard list (every Yes combination) and on 500 randomly edited lists. The generator is seeded, so a
 * failure names a case that reproduces.
 *
 * D10: over the criteria that are Yes AND Active, lead.startDays is the largest startDays and, separately,
 * lead.endDays the largest endDays (A 10/3 + B 8/7 gives +10/+7). The criteria holding each maximum are listed in
 * Plan Check List order, names in startFrom/endFrom and ids in startFromIds/endFromIds. No such criteria gives 0/0.
 */

/**
 * The reference, written separately from computeLead on purpose: plain loops in list order. Days here are whole
 * numbers from 0 (the Plan Check List page accepts 0 to 365), so a maximum that starts at 0 is the D10 rule.
 */
function referenceLead(checks: readonly PlanCheck[], yesIds: readonly string[]): GuideLead {
  const isYes = (id: string): boolean => {
    for (const yes of yesIds) {
      if (yes === id) return true;
    }
    return false;
  };
  const counted: PlanCheck[] = [];
  for (const check of checks) {
    if (check.active === true && isYes(check.id)) counted.push(check);
  }
  let startDays = 0;
  let endDays = 0;
  for (const check of counted) {
    if (check.startDays > startDays) startDays = check.startDays;
    if (check.endDays > endDays) endDays = check.endDays;
  }
  const lead: GuideLead = { startDays, endDays, startFrom: [], endFrom: [], startFromIds: [], endFromIds: [] };
  for (const check of counted) {
    if (check.startDays === startDays) {
      lead.startFrom.push(check.name);
      lead.startFromIds.push(check.id);
    }
    if (check.endDays === endDays) {
      lead.endFrom.push(check.name);
      lead.endFromIds.push(check.id);
    }
  }
  return lead;
}

/** mulberry32: a small seeded pseudo-random generator, so every run builds the same cases. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261121;
const LISTS = 500;
const YES_SETS_PER_LIST = 3;
const D9_IDS = PLAN_CHECK_LIST_DEFAULTS.map((check) => check.id);

interface Case {
  caseNo: string;
  checks: PlanCheck[];
  yesIds: string[];
}

function buildCases(): Case[] {
  const random = seededRandom(SEED);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const text = (alphabet: string, min: number, max: number) => {
    let out = '';
    for (let i = int(min, max); i > 0; i--) out += pick(alphabet.split(''));
    return out;
  };
  const shuffle = <T>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };

  const cases: Case[] = [];
  for (let listNo = 0; listNo < LISTS; listNo++) {
    // An edited list: 0 to 12 criteria with unique ids and names (as the Plan Check List page keeps them).
    const size = int(0, 12);
    const ids = new Set<string>();
    const names = new Set<string>();
    const checks: PlanCheck[] = [];
    while (checks.length < size) {
      const idKind = random();
      const id =
        idKind < 0.2 ? pick(D9_IDS) : idKind < 0.5 ? `chk_${text('0123456789abcdef', 24, 24)}` : text('abcdefghijklmnopqrstuvwxyz_0123456789', 1, 8);
      const name = `${text('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 1, 10)}${random() < 0.3 ? ` ${text('abcdefghij', 1, 5)}` : ''}`;
      if (ids.has(id) || names.has(name.toLowerCase())) continue;
      ids.add(id);
      names.add(name.toLowerCase());
      // Deliberate ties: often copy a value from an earlier criterion, or the largest value so far.
      const days = (key: 'startDays' | 'endDays') => {
        const roll = random();
        if (checks.length && roll < 0.3) return pick(checks)[key];
        if (checks.length && roll < 0.45) return Math.max(...checks.map((check) => check[key]));
        return int(0, 30);
      };
      checks.push({ id, name, startDays: days('startDays'), endDays: days('endDays'), active: random() < 0.75 });
    }

    for (let setNo = 0; setNo < YES_SETS_PER_LIST; setNo++) {
      // Yes ids: some of the list (active or not), plus unknown ids, a different-case copy and repeats, in any order.
      const yesIds: string[] = checks.filter(() => random() < 0.5).map((check) => check.id);
      for (let i = int(0, 3); i > 0; i--) {
        const roll = random();
        if (roll < 0.4) yesIds.push(`removed_${text('abcdefghijklmnopqrstuvwxyz', 1, 6)}`);
        else if (roll < 0.7) yesIds.push(pick(D9_IDS));
        else if (checks.length) yesIds.push(pick(checks).id.toUpperCase());
      }
      if (yesIds.length && random() < 0.5) {
        for (let i = int(1, 3); i > 0; i--) yesIds.push(pick(yesIds));
      }
      cases.push({ caseNo: `seed ${SEED}, list ${listNo}, yes set ${setNo}`, checks, yesIds: shuffle(yesIds) });
    }
  }
  return cases;
}

const freezeList = (checks: PlanCheck[]): readonly PlanCheck[] => Object.freeze(checks.map((check) => Object.freeze({ ...check })));

describe('computeLead equals the D10 reference', () => {
  it('on all 512 Yes combinations of the standard list (any Yes order)', () => {
    expect(PLAN_CHECK_LIST_DEFAULTS).toHaveLength(9);
    for (let mask = 0; mask < 512; mask++) {
      const yesIds = D9_IDS.filter((_, bit) => mask & (1 << bit));
      const expected = referenceLead(PLAN_CHECK_LIST_DEFAULTS, yesIds);
      expect(computeLead(PLAN_CHECK_LIST_DEFAULTS, yesIds), `mask ${mask}: ${yesIds.join(',')}`).toEqual(expected);
      expect(computeLead(PLAN_CHECK_LIST_DEFAULTS, [...yesIds].reverse()), `mask ${mask} reversed`).toEqual(expected);
    }
    // Spot checks of the reference itself: the standard list with every criterion Yes, and the D10 example.
    expect(referenceLead(PLAN_CHECK_LIST_DEFAULTS, D9_IDS)).toEqual({
      startDays: 12,
      endDays: 9,
      startFrom: ['CPB'],
      endFrom: ['CPB', 'Mercerized'],
      startFromIds: ['cpb'],
      endFromIds: ['cpb', 'mercerized'],
    });
    const a = { id: 'a', name: 'A', startDays: 10, endDays: 3, active: true };
    const b = { id: 'b', name: 'B', startDays: 8, endDays: 7, active: true };
    expect(referenceLead([a, b], ['b', 'a'])).toEqual({
      startDays: 10,
      endDays: 7,
      startFrom: ['A'],
      endFrom: ['B'],
      startFromIds: ['a'],
      endFromIds: ['b'],
    });
  });

  it(`on ${LISTS} randomly edited lists with ${YES_SETS_PER_LIST} random Yes sets each (seeded)`, () => {
    const cases = buildCases();
    expect(cases).toHaveLength(LISTS * YES_SETS_PER_LIST);
    const seen = { counted: 0, none: 0, startAndEndFromDifferentCriteria: 0, ties: 0, yesButInactive: 0, unknownIds: 0, repeatedIds: 0 };

    for (const { caseNo, checks, yesIds } of cases) {
      const list = freezeList(checks);
      const yes = Object.freeze([...yesIds]);
      const expected = referenceLead(list, yes);
      expect(computeLead(list, yes), `${caseNo}: ${JSON.stringify({ checks, yesIds })}`).toEqual(expected);

      // What this case exercised, so a generator that stopped covering a path is noticed.
      const listIds = new Set(checks.map((check) => check.id));
      if (expected.startFromIds.length) seen.counted++;
      else seen.none++;
      if (expected.startFromIds.join('|') !== expected.endFromIds.join('|')) seen.startAndEndFromDifferentCriteria++;
      if (expected.startFromIds.length > 1 || expected.endFromIds.length > 1) seen.ties++;
      if (checks.some((check) => !check.active && yesIds.includes(check.id))) seen.yesButInactive++;
      if (yesIds.some((id) => !listIds.has(id))) seen.unknownIds++;
      if (new Set(yesIds).size < yesIds.length) seen.repeatedIds++;
    }

    expect(seen.counted).toBeGreaterThan(600);
    expect(seen.none).toBeGreaterThan(50);
    expect(seen.startAndEndFromDifferentCriteria).toBeGreaterThan(150);
    expect(seen.ties).toBeGreaterThan(150);
    expect(seen.yesButInactive).toBeGreaterThan(150);
    expect(seen.unknownIds).toBeGreaterThan(150);
    expect(seen.repeatedIds).toBeGreaterThan(150);
  });
});
