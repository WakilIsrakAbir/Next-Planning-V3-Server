import { buildKeyMap, getVal } from './normalizer.js';

/* Item id matching between a department file's rows (Order.<dept>Items) and the saved
   plan items (OrderDate.<dept>). Port of the old backend's routes/upload.js helpers
   generateBackendItemId / findMatchingPlan, so both apps produce the same itemIds. */

type Row = Record<string, any>;

/** Normalizes a stored itemId the same way the old backend does. */
export function normalizeItemId(id: unknown): string {
  return String(id).toLowerCase().replace(/\s+/g, '');
}

/** Generates a consistent itemId for a department item. */
export function generateBackendItemId(row: Row | null | undefined, dept: string, orderNo: string): string {
  if (!row) return '';
  if (row.itemId) return normalizeItemId(row.itemId);

  const km = buildKeyMap(row);
  const bNo = String(
    getVal(row, ['BookingNo', 'OrderNo', 'EWO', 'Booking', 'Order No', 'Booking No'], km) || orderNo || 'N/A'
  ).trim();
  const color = String(getVal(row, ['Color', 'Colour', 'Fab Color'], km) || 'N/A').trim();

  if (dept === 'knitting' || dept === 'delivery') {
    const fabConst = String(
      getVal(row, ['FabricConstruction', 'Fabric Construction', 'Construction', 'Fab Const', 'Fabric'], km) || 'N/A'
    ).trim();
    const gsm = String(getVal(row, ['GSM', 'G.S.M', 'Body GSM'], km) || 'N/A').trim();
    return `${bNo}_${color}_${fabConst}_${gsm}`.toLowerCase().replace(/\s+/g, '');
  } else if (dept === 'yd') {
    const type = String(getVal(row, ['Booking Type', 'Type', 'YD Type', 'BookingType'], km) || 'N/A').trim();
    const ydb = String(getVal(row, ['YDB', 'YD B'], km) || 'N/A').trim();
    return `${bNo}_${type}_${ydb}`.toLowerCase().replace(/\s+/g, '');
  } else {
    // dyeing, finishing
    let procName = String(getVal(row, ['Process Name', 'ProcessName', 'Process'], km) || '').trim();
    if (procName.toLowerCase() === 'n/a' || procName === '-') procName = '';
    return `${bNo}_${color}_${procName}`.toLowerCase().replace(/\s+/g, '');
  }
}

/** Builds the itemId -> saved plan item map for one order and department. */
export function buildPlanMap(savedPlans: Row[], dept: string, orderNo: string): Map<string, Row> {
  const planMap = new Map<string, Row>();
  savedPlans.forEach((p) => {
    const id = p.itemId ? normalizeItemId(p.itemId) : generateBackendItemId(p.itemData || p, dept, orderNo);
    if (id) planMap.set(id, p);
  });
  return planMap;
}

/**
 * Finds the saved plan item for an Excel item even if the itemId format had minor variations:
 * exact id, id with/without a trailing `_n/a` or `_`, then colour (Dyeing/Finishing) or YDB (YD).
 * The colour and YDB fallbacks build the key map of the saved item (old commit 6e89cf6).
 */
export function findMatchingPlan(
  planMap: Map<string, Row> | null | undefined,
  item: Row,
  dept: string,
  orderNo: string
): Row | null {
  if (!planMap || planMap.size === 0) return null;
  const rawId = generateBackendItemId(item, dept, orderNo);
  if (planMap.has(rawId)) return planMap.get(rawId)!;

  // Try alternate trailing _n/a or _
  if (rawId.endsWith('_n/a')) {
    const altId = rawId.slice(0, -3);
    if (planMap.has(altId)) return planMap.get(altId)!;
  } else if (rawId.endsWith('_')) {
    const altId = rawId + 'n/a';
    if (planMap.has(altId)) return planMap.get(altId)!;
  }

  // Try stripping all trailing underscores or n/a
  const cleanId = rawId.replace(/(_n\/a|_)$/i, '');
  for (const [key, plan] of planMap.entries()) {
    const keyClean = key.replace(/(_n\/a|_)$/i, '');
    if (keyClean === cleanId) return plan;
  }

  // Fallback for dyeing / finishing by Color
  if (dept === 'dyeing' || dept === 'finishing') {
    const km = buildKeyMap(item);
    const color = String(getVal(item, ['Color', 'Colour', 'Fab Color'], km) || '')
      .trim()
      .toLowerCase();
    if (color) {
      for (const plan of planMap.values()) {
        const source = plan.itemData || plan;
        const pColor = String(getVal(source, ['Color', 'Colour', 'Fab Color'], buildKeyMap(source)) || '')
          .trim()
          .toLowerCase();
        if (pColor && pColor === color) return plan;
      }
    }
  }

  // Fallback for YD by YDB
  if (dept === 'yd') {
    const km = buildKeyMap(item);
    const ydb = String(getVal(item, ['YDB', 'YD B'], km) || '')
      .trim()
      .toLowerCase();
    if (ydb && ydb !== 'n/a') {
      for (const plan of planMap.values()) {
        const source = plan.itemData || plan;
        const pYdb = String(getVal(source, ['YDB', 'YD B'], buildKeyMap(source)) || '')
          .trim()
          .toLowerCase();
        if (pYdb && pYdb === ydb) return plan;
      }
    }
  }

  return null;
}
