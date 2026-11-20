import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OrderService } from '../src/services/order.service.js';
import { StatusEngineService } from '../src/services/status-engine.service.js';
import { HttpError } from '../src/utils/http-error.js';
import {
  PLAN_DEPTS,
  UNSAVED_FINGERPRINT,
  fingerprintAllDepts,
  fingerprintDept,
  isUnsavedDept,
} from '../src/utils/plan-fingerprint.js';
import { planRows } from './helpers/plan-data.js';

// Pure helpers of the save-plans work (no database).

const doc = (rows: any[], status = 'On Process', dept = 'dyeing') => ({ orderNo: 'X', [dept]: rows, [`${dept}Status`]: status });

describe('fingerprintDept', () => {
  const rows = planRows('X1', 'dyeing', 3);

  it('is the sha1 of the documented JSON of status and plan fields', () => {
    const item = { itemId: 'a', planType: 'Confirm', itemData: { Unit: 'U1', Color: 'RED' }, startDate: null };
    const expected = {
      status: 'Tentative',
      items: [
        {
          itemId: 'a',
          planType: 'Confirm',
          startDate: '',
          endDate: '',
          floorStartDate: '',
          floorEndDate: '',
          floorPlanType: '',
          yarnDate: '',
          yarnOkDate: '',
          matchingOptionDate: '',
          limitation: '',
          remarks: '',
          unit: '',
          processName: '',
          barrierQty: '',
          workableQty: '',
          'itemData.Unit': 'U1',
          'itemData.ProcessName': '',
          'itemData.Process Name': '',
          'itemData.Barrier Qty.': '',
          'itemData.Workable Qty.': '',
        },
      ],
    };
    const sha1 = createHash('sha1').update(JSON.stringify(expected)).digest('hex');
    expect(fingerprintDept(doc([item], 'Tentative'), 'dyeing')).toBe(sha1);
  });

  it('is stable: same content gives the same fingerprint, whatever the key order of the rows', () => {
    const reordered = rows.map((row) => Object.fromEntries(Object.entries(row).reverse()));
    expect(fingerprintDept(doc(rows), 'dyeing')).toBe(fingerprintDept(doc(structuredClone(rows)), 'dyeing'));
    expect(fingerprintDept(doc(reordered), 'dyeing')).toBe(fingerprintDept(doc(rows), 'dyeing'));
  });

  it('changes with the status, a plan field, the row order or a row', () => {
    const base = fingerprintDept(doc(rows), 'dyeing');
    expect(fingerprintDept(doc(rows, 'Completed'), 'dyeing')).not.toBe(base);
    for (const field of ['planType', 'startDate', 'endDate', 'limitation', 'remarks', 'unit', 'processName', 'itemId']) {
      const edited = structuredClone(rows);
      edited[1][field] = 'changed';
      expect(fingerprintDept(doc(edited), 'dyeing'), field).not.toBe(base);
    }
    expect(fingerprintDept(doc([...rows].reverse()), 'dyeing')).not.toBe(base);
    expect(fingerprintDept(doc(rows.slice(1)), 'dyeing')).not.toBe(base);
  });

  it('includes the five hand-edited itemData keys and ignores every other itemData key', () => {
    const base = fingerprintDept(doc(rows), 'dyeing');
    for (const key of ['Unit', 'ProcessName', 'Process Name', 'Barrier Qty.', 'Workable Qty.']) {
      const edited = structuredClone(rows);
      edited[0].itemData[key] = 'edited';
      expect(fingerprintDept(doc(edited), 'dyeing'), key).not.toBe(base);
    }
    const excel = structuredClone(rows);
    excel[0].itemData.DyeingProd = 999;
    excel[0].itemData.RequiredQtyKgs = 1;
    excel[0].itemData.NewColumn = 'x';
    expect(fingerprintDept(doc(excel), 'dyeing')).toBe(base);
  });

  it('ignores keys outside the list, and normalises null/undefined to "" and other values to strings', () => {
    const base = fingerprintDept(doc(rows), 'dyeing');
    const extra = rows.map((row) => ({ ...row, source: 'v2', confirmDate: '2026-01-01' }));
    expect(fingerprintDept(doc(extra), 'dyeing')).toBe(base);
    const a = [{ itemId: 'a', remarks: null, limitation: undefined, workableQty: 5 }];
    const b = [{ itemId: 'a', remarks: '', workableQty: '5' }];
    expect(fingerprintDept(doc(a), 'dyeing')).toBe(fingerprintDept(doc(b), 'dyeing'));
  });

  it('reads only its own department', () => {
    const both = { dyeing: rows, dyeingStatus: 'Confirm', knitting: planRows('X1', 'knitting', 2), knittingStatus: 'Tentative' };
    const dyeingOnly = { dyeing: rows, dyeingStatus: 'Confirm' };
    expect(fingerprintDept(both, 'dyeing')).toBe(fingerprintDept(dyeingOnly, 'dyeing'));
    expect(fingerprintDept(both, 'knitting')).not.toBe(fingerprintDept(dyeingOnly, 'knitting'));
  });

  it('treats a missing document, missing rows and a non-array as no rows', () => {
    expect(fingerprintDept(null, 'knitting')).toBe(UNSAVED_FINGERPRINT);
    expect(fingerprintDept(undefined, 'yd')).toBe(UNSAVED_FINGERPRINT);
    expect(fingerprintDept({ orderNo: 'X' }, 'yd')).toBe(UNSAVED_FINGERPRINT);
    expect(fingerprintDept({ knitting: { not: 'rows' } }, 'knitting')).toBe(UNSAVED_FINGERPRINT);
    expect(fingerprintDept({ knitting: [], knittingStatus: 'On Process' }, 'knitting')).not.toBe(UNSAVED_FINGERPRINT);
  });

  it('fingerprintAllDepts gives one fingerprint per department', () => {
    const all = fingerprintAllDepts(doc(rows));
    expect(Object.keys(all)).toEqual([...PLAN_DEPTS]);
    expect(all.dyeing).toBe(fingerprintDept(doc(rows), 'dyeing'));
    expect(all.knitting).toBe(UNSAVED_FINGERPRINT);
  });
});

describe('isUnsavedDept', () => {
  it('is true only without rows and with a missing, empty or default status', () => {
    expect(isUnsavedDept(null, 'knitting')).toBe(true);
    expect(isUnsavedDept({}, 'knitting')).toBe(true);
    expect(isUnsavedDept({ knitting: [], knittingStatus: 'On Process' }, 'knitting')).toBe(true);
    expect(isUnsavedDept({ knitting: [], knittingStatus: '' }, 'knitting')).toBe(true);
    expect(isUnsavedDept({ knitting: [], knittingStatus: 'Completed' }, 'knitting')).toBe(false);
    expect(isUnsavedDept({ knitting: planRows('X', 'knitting', 1), knittingStatus: 'On Process' }, 'knitting')).toBe(false);
  });
});

describe('OrderService.buildDeptSet (shared by save-dates and save-plans)', () => {
  it('sets the rows, a non-empty status and a sent completed date, in that order', () => {
    const rows = planRows('X', 'knitting', 1);
    expect(OrderService.buildDeptSet('knitting', rows, 'Confirm', '2026-11-21')).toEqual({
      knitting: rows,
      knittingStatus: 'Confirm',
      knittingCompletedDate: '2026-11-21',
    });
    expect(Object.keys(OrderService.buildDeptSet('knitting', rows, 'Confirm', ''))).toEqual(['knitting', 'knittingStatus', 'knittingCompletedDate']);
  });

  it('leaves out missing rows, an empty status and an unsent completed date', () => {
    expect(OrderService.buildDeptSet('dyeing', undefined, '', undefined)).toEqual({});
    expect(OrderService.buildDeptSet('dyeing', [], undefined)).toEqual({ dyeing: [] });
    expect(OrderService.buildDeptSet('dyeing', null, 'Pending', '')).toEqual({ dyeingStatus: 'Pending', dyeingCompletedDate: '' });
  });
});

describe('StatusEngineService.computeSaveStatus (shared by save-dates and save-plans)', () => {
  const rows = (...types: unknown[]) => types.map((planType) => ({ planType }));

  it('gives Completed for a Completed order status, whatever the rows', () => {
    expect(StatusEngineService.computeSaveStatus('knitting', rows(''), 'Completed')).toBe('Completed');
    expect(StatusEngineService.computeSaveStatus('knitting', [], 'Completed')).toBe('Completed');
  });

  it('follows the plan types otherwise', () => {
    expect(StatusEngineService.computeSaveStatus('knitting', rows('Confirm', 'Confirm'))).toBe('Confirm');
    expect(StatusEngineService.computeSaveStatus('knitting', rows('Confirm', 'Tentative'), 'Confirm')).toBe('Tentative');
    expect(StatusEngineService.computeSaveStatus('knitting', rows('Tentative', 'Select'))).toBe('Pending');
    expect(StatusEngineService.computeSaveStatus('knitting', rows('Confirm', ''))).toBe('Pending');
    expect(StatusEngineService.computeSaveStatus('knitting', rows('Pending', 'Tentative'))).toBe('Tentative');
    expect(StatusEngineService.computeSaveStatus('knitting', rows('Pending'))).toBe('Pending');
    expect(StatusEngineService.computeSaveStatus('knitting', rows(1))).toBe('Pending');
    expect(StatusEngineService.computeSaveStatus('knitting', [])).toBe('Pending');
    expect(StatusEngineService.computeSaveStatus('knitting', null as any)).toBe('Pending');
  });

  it('reads only planType for Delivery, as save-dates does (not the floor plan type)', () => {
    expect(StatusEngineService.computeSaveStatus('delivery', [{ planType: '', floorPlanType: 'Confirm' }])).toBe('Pending');
    expect(StatusEngineService.computeSaveStatus('delivery', [{ planType: 'Confirm', floorPlanType: '' }])).toBe('Confirm');
  });
});

describe('HttpError', () => {
  it('keeps its old body without details', () => {
    expect(new HttpError(400, 'Bad', 'INVALID').toJSON()).toEqual({ code: 'INVALID', message: 'Bad' });
    expect(new HttpError(404, 'Missing').toJSON()).toEqual({ message: 'Missing' });
  });

  it('merges details after code and message, never replacing them', () => {
    const error = new HttpError(409, 'Changed', 'CONFLICT', { departments: ['dyeing'], code: 'X', message: 'Y' });
    expect(error.toJSON()).toEqual({ code: 'CONFLICT', message: 'Changed', departments: ['dyeing'] });
    expect(Object.keys(error.toJSON())).toEqual(['code', 'message', 'departments']);
    expect(JSON.parse(JSON.stringify(error))).toEqual({ code: 'CONFLICT', message: 'Changed', departments: ['dyeing'] });
  });
});
