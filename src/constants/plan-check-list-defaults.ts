/* Standard Plan Check List (Data Management > Plan Check List), all Active, in display order.
   PlanCheckListService.ensure() writes it only when the list does not exist yet; a list a user has saved is never
   refilled, even when it is empty. The page's "Reset to Standard" uses the copy GET /api/plan-check-list sends
   (`defaults`), so the client keeps no copy of its own.
   The ids are fixed: order guides refer to criteria by id, so they stay linked after a rename or a Reset. */
import type { IPlanCheckItem } from '../models/PlanningSetting.model.js';

export const PLAN_CHECK_LIST_DEFAULTS: readonly Readonly<IPlanCheckItem>[] = Object.freeze([
  { id: 'heatset', name: 'Heatset', startDays: 10, endDays: 7, active: true },
  { id: 'peach_brush', name: 'Peach/brush', startDays: 0, endDays: 0, active: true },
  { id: 'cpb', name: 'CPB', startDays: 12, endDays: 9, active: true },
  { id: 'singeing', name: 'Singeing', startDays: 7, endDays: 7, active: true },
  { id: 'subcontract', name: 'Subcontract', startDays: 0, endDays: 0, active: true },
  { id: 'yd_pre', name: 'YD Pre', startDays: 6, endDays: 4, active: true },
  { id: 'yd_post', name: 'YD Post', startDays: 6, endDays: 4, active: true },
  { id: 'mercerized', name: 'Mercerized', startDays: 11, endDays: 9, active: true },
  { id: 'semibleach', name: 'Semibleach', startDays: 6, endDays: 5, active: true },
].map((item) => Object.freeze(item)));

/** A fresh, mutable copy of the standard list. */
export function planCheckListDefaults(): IPlanCheckItem[] {
  return PLAN_CHECK_LIST_DEFAULTS.map((item) => ({ ...item }));
}
