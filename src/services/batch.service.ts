/* Batch Plan module service (/api/batch): the unit list, the page data and saving plans, Setup tables and
   batch cards. Ported from the old backend's routes/batch.js with the same rules, because both apps read
   and write the same Batch* records. Reads Order / DeptValidOrders / OrderDate / DropdownMaster and writes
   only the Batch* collections. */
import type { Request } from 'express';
import { Order } from '../models/Order.model.js';
import { DeptValidOrders } from '../models/DeptValidOrders.model.js';
import { OrderDate } from '../models/OrderDate.model.js';
import { DropdownMaster } from '../models/DropdownMaster.model.js';
import { BatchPlan } from '../models/BatchPlan.model.js';
import { BatchSetting, BatchSettingKey } from '../models/BatchSetting.model.js';
import { BatchCard } from '../models/BatchCard.model.js';
import { BatchBpData } from '../models/BatchBpData.model.js';
import * as S from '../utils/batch-rules.js';
import { SETUP_DEFAULTS } from '../constants/batch-setup-defaults.js';
import { HttpError } from '../utils/http-error.js';

type BatchUser = Request['user'];

const MAX_PLANS_PER_SAVE = 1000;
const MAX_CARDS_PER_SAVE = 5000;

const SETTING_PERMISSIONS: Record<BatchSettingKey, string> = {
  setup: 'menus.dataManagement.dyeingMc',
  flatAllowance: 'menus.dataManagement.flatAllowance',
  unitSetup: 'menus.dataManagement.unitSetup',
};
const ACTION_LABELS: Record<string, string> = {
  'actions.batchEdit': 'edit batch plans',
  'actions.batchTentative': 'make a batch plan Tentative',
  'actions.batchConfirm': 'confirm or re-confirm batch plans',
  'actions.batchInternalChange': 'approve Internal change',
  'actions.batchMovePending': 'move a batch plan to Pending',
  'actions.batchCardGenerate': 'generate batch cards',
};

type LeanDoc = Record<string, any>;

// Same buyer restriction rule as the orders API (non-admin users with selected buyers).
async function allowedBuyerSet(user: Request['user']): Promise<Set<string> | null> {
  if (S.isAdmin(user)) return null;
  const perms: any = (user as any)?.permissions?.buyers;
  if (!perms || perms.accessType === 'all') return null;
  if (perms.accessType === 'none' || !Array.isArray(perms.buyerIds) || !perms.buyerIds.length) return new Set();
  const raw: string[] = await Order.distinct('buyer');
  return new Set(
    raw.filter((b) =>
      perms.buyerIds.includes(
        String(b)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
      )
    )
  );
}

/* Setup tables (Dyeing MC, Flat Allowance, Unit Setup) start with the demo's defaults.
   A missing table is created with them. A table that is still the empty record no user ever saved
   (version 1, updatedBy 'system') is filled once; its version goes up, so a page opened before that
   gets the "changed by another user" message instead of saving the empty table again.
   A table a user has saved (version 2 or more) is never touched, even when it is empty. */
async function ensureSettings(): Promise<LeanDoc[]> {
  const existing = await BatchSetting.find({}).lean();
  const byKey = new Map(existing.map((s) => [s.key, s]));
  for (const key of ['setup', 'flatAllowance', 'unitSetup'] as BatchSettingKey[]) {
    const doc = byKey.get(key);
    if (!doc) {
      try {
        await BatchSetting.create({ key, value: SETUP_DEFAULTS[key], version: 1, updatedBy: 'system' });
      } catch (error: any) {
        if (error.code !== 11000) throw error;
      }
    } else if (doc.version === 1 && doc.updatedBy === 'system' && Array.isArray(doc.value) && doc.value.length === 0) {
      await BatchSetting.updateOne(
        { key, version: 1, updatedBy: 'system', value: { $size: 0 } },
        { $set: { value: SETUP_DEFAULTS[key] }, $inc: { version: 1 } }
      );
    }
  }
  return BatchSetting.find({}).lean();
}

// Units for Unit Setup: Dropdown Master Setup's UNIT list (ACTIVE and HIDDEN, in its own order).
// Same defaults as the dropdown service when that list was never created; nothing is written here.
const DEFAULT_UNITS = ['EFL', 'EKL', 'Ext', 'Outside'];
async function unitOptions(): Promise<{ name: string; status: string }[]> {
  const docs = await DropdownMaster.find({ type: 'UNIT' }, { name: 1, status: 1 }).sort({ createdAt: 1 }).lean();
  if (!docs.length) return DEFAULT_UNITS.map((name) => ({ name, status: 'ACTIVE' }));
  return docs
    .map((doc) => ({ name: String(doc.name || '').trim(), status: doc.status || 'ACTIVE' }))
    .filter((unit) => unit.name);
}

/* Unit Setup buyers, once each: the buyers of the orders in the latest uploaded files (General and the
   department files, as DeptValidOrders lists them). Orders of older uploads stay in the database, so their
   buyers are left out here. Before any file list exists (or after Clear All), every buyer, as before. */
const UPLOAD_FILES = ['general', 'yd', 'knitting', 'dyeing', 'finishing', 'delivery'];
const NOT_A_BUYER = new Set(['', 'UNDEFINED', 'N/A', 'GENERAL', 'PENDING', 'UNKNOWN']);
async function buyerNames(): Promise<string[]> {
  const lists = await DeptValidOrders.find({ dept: { $in: UPLOAD_FILES } }, { validOrderNos: 1 }).lean();
  const orderNos = Array.from(new Set(lists.flatMap((list) => list.validOrderNos || [])));
  const names = new Map<string, string>();
  for (const value of await Order.distinct('buyer', orderNos.length ? { orderNo: { $in: orderNos } } : {})) {
    const name = String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    const key = S.unitBuyerKey(name);
    if (!NOT_A_BUYER.has(key) && !names.has(key)) names.set(key, name);
  }
  return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
}

const ORDER_FIELDS: Record<string, 1> = {
  orderNo: 1,
  buyer: 1,
  buyerTeam: 1,
  bookingDate: 1,
  eventDay: 1,
  style: 1,
  pmc: 1,
  bookedBy: 1,
  bookingBy: 1,
  floor: 1,
  gmtUnit: 1,
  brush: 1,
  peach: 1,
  heatset: 1,
  knitStart: 1,
  knitEnd: 1,
  dyeStart: 1,
  dyeEnd: 1,
  deliStart: 1,
  deliEnd: 1,
  ship1: 1,
  shipLast: 1,
  fabricNotes: 1,
  pmcNotes: 1,
  knittingPlanStatus: 1,
  dyeingPlanStatus: 1,
  deliveryPlanStatus: 1,
  knittingItems: 1,
  dyeingItems: 1,
};
// For the unit list only: the knitting colour headers the unit rule reads (exact names, as the page's
// firstUploadedValue reads them) instead of whole knitting rows, to keep memory low on every page load.
const UNIT_ORDER_FIELDS: Record<string, 1> = {
  orderNo: 1,
  buyer: 1,
  floor: 1,
  dyeingItems: 1,
  'knittingItems.Color': 1,
  'knittingItems.Colour': 1,
  'knittingItems.Shade': 1,
  'knittingItems.Color Name': 1,
  'knittingItems.Colour Name': 1,
};
async function generalOrders(user: Request['user'], fields: Record<string, 1> = ORDER_FIELDS): Promise<LeanDoc[]> {
  const valid = await DeptValidOrders.findOne({ dept: 'general' }).lean();
  const filter: Record<string, any> = valid?.validOrderNos?.length ? { orderNo: { $in: valid.validOrderNos } } : {};
  const buyers = await allowedBuyerSet(user);
  if (buyers) filter.buyer = { $in: Array.from(buyers) };
  return Order.find(filter, fields).lean();
}

/* Units of these orders' knitting rows, from the Dyeing Plan unit, and the data they need: the latest
   Dyeing file's order list and the saved Dyeing Plan units. */
// Only what the Dyeing screen's unit rule reads from a saved Dyeing row (utils/batch-rules.ts dyeingScreenUnits).
const UNIT_DATE_FIELDS: Record<string, 1> = { orderNo: 1, 'dyeing.itemId': 1, 'dyeing.itemData.Unit': 1, 'dyeing.itemData.Color': 1 };
// For GET /state also the saved plan dates (utils/batch-rules.ts modulePlanDates).
const PLAN_DATE_FIELDS: Record<string, 1> = {
  ...UNIT_DATE_FIELDS,
  'knitting.planType': 1,
  'knitting.startDate': 1,
  'knitting.endDate': 1,
  'dyeing.planType': 1,
  'dyeing.startDate': 1,
  'dyeing.endDate': 1,
  'delivery.planType': 1,
  'delivery.floorPlanType': 1,
  'delivery.startDate': 1,
  'delivery.endDate': 1,
  'delivery.floorStartDate': 1,
  'delivery.floorEndDate': 1,
};
async function orderUnits(
  orders: LeanDoc[],
  fields: Record<string, 1> = UNIT_DATE_FIELDS
): Promise<{ usedKeys: Map<string, string>; keysByOrder: Map<string, string[]>; orderDateByNo: Map<string, LeanDoc> }> {
  const [dyeingValid, orderDates] = await Promise.all([
    DeptValidOrders.findOne({ dept: 'dyeing' }).lean(),
    OrderDate.find({ orderNo: { $in: orders.map((o) => o.orderNo) } }, fields).lean(),
  ]);
  // Like the Dyeing Plan list, only orders in the latest Dyeing file use their Dyeing rows; the others use the General 'Unit'.
  const dyeingOrders = dyeingValid?.validOrderNos?.length ? new Set<string>(dyeingValid.validOrderNos) : null;
  const orderDateByNo = new Map<string, LeanDoc>(orderDates.map((doc: LeanDoc) => [doc.orderNo, doc]));
  return { ...S.unitsForOrders(orders, { orderDateByNo, dyeingOrders }), orderDateByNo };
}

/* Units that these orders' saved plans and cards keep in the unit list: the same rules as GET /state
   (S.planRetainedUnits, S.cardRetainedUnit). Each record stores its units when it is saved, so the unit
   list does not parse every saved plan on each page load. A record saved before these fields existed, or a
   plan saved since by an older server (its version moved on), is read once here and its fields are filled
   in, without changing its version or updatedAt (the old backend does exactly the same). */
async function retainedUnits(orderKeys: string[]): Promise<Set<string>> {
  const units = new Set<string>();
  const [plans, cards] = await Promise.all([
    BatchPlan.find({ orderKey: { $in: orderKeys } }, { orderKey: 1, version: 1, retainedUnits: 1, retainedVersion: 1 }).lean(),
    BatchCard.find({ orderKey: { $in: orderKeys } }, { cardId: 1, retainedUnit: 1 }).lean(),
  ]);
  const stalePlans: string[] = [];
  const staleCards: string[] = [];
  for (const plan of plans) {
    if (plan.retainedVersion === plan.version && Array.isArray(plan.retainedUnits)) plan.retainedUnits.forEach((unit) => units.add(unit));
    else stalePlans.push(plan.orderKey);
  }
  for (const card of cards) {
    if (typeof card.retainedUnit !== 'string') staleCards.push(card.cardId);
    else if (card.retainedUnit) units.add(card.retainedUnit);
  }
  const saveFields = async (model: typeof BatchPlan | typeof BatchCard, ops: any[]): Promise<void> => {
    if (!ops.length) return;
    try {
      await (model as any).bulkWrite(ops, { ordered: false, timestamps: false });
    } catch (error) {
      console.error('Batch retained units not saved:', error);
    }
  };
  // In small groups, so only a few saved plans are parsed at a time.
  for (let i = 0; i < stalePlans.length; i += 100) {
    const docs = await BatchPlan.find({ orderKey: { $in: stalePlans.slice(i, i + 100) } }, { orderKey: 1, version: 1, stateJson: 1 }).lean();
    await saveFields(
      BatchPlan,
      docs.map((doc) => {
        let state: any = {};
        try {
          state = JSON.parse(doc.stateJson || '{}');
        } catch {
          state = {};
        }
        const kept = S.planRetainedUnits(state);
        kept.forEach((unit) => units.add(unit));
        return {
          updateOne: {
            filter: { orderKey: doc.orderKey, version: doc.version },
            update: { $set: { retainedUnits: kept, retainedVersion: doc.version } },
          },
        };
      })
    );
  }
  for (let i = 0; i < staleCards.length; i += 200) {
    const docs = await BatchCard.find({ cardId: { $in: staleCards.slice(i, i + 200) } }, { cardId: 1, cardJson: 1 }).lean();
    await saveFields(
      BatchCard,
      docs.map((doc) => {
        let card: any = null;
        try {
          card = JSON.parse(doc.cardJson);
        } catch {
          card = null;
        }
        const unit = S.cardRetainedUnit(card);
        if (unit) units.add(unit);
        return {
          updateOne: {
            filter: { cardId: doc.cardId, retainedUnit: { $exists: false } },
            update: { $set: { retainedUnit: unit } },
          },
        };
      })
    );
  }
  return units;
}

export class BatchService {
  /** The unit list for the sidebar, the page heading tabs and Manage Users ([] without Batch access). */
  static async getUnits(user: BatchUser): Promise<S.BatchUnit[]> {
    if (!S.hasBatchAccess(user)) return [];
    const orders = await generalOrders(user, UNIT_ORDER_FIELDS);
    const [{ usedKeys }, dropdownUnits, kept] = await Promise.all([
      orderUnits(orders),
      unitOptions(),
      retainedUnits(orders.map((o) => S.normalizeBookingKey(o.orderNo))),
    ]);
    // Same list as GET /state's batchUnits: units of the rows, then units kept by plans and cards.
    for (const unit of kept) if (!usedKeys.has(unit)) usedKeys.set(unit, unit);
    return S.orderedUnits(usedKeys, dropdownUnits);
  }

  /** Everything the Batch Plan page needs (the page's appState shape) as JSON text, with Server-Timing phases. */
  static async getState(user: BatchUser): Promise<{ body: string; serverTiming: string }> {
  // The time of each phase goes into a Server-Timing header (DevTools > Network, and the page's load
  // summary), so a slow load can be traced to the database, the build or the download.
  const started = Date.now();
  const phases: string[] = [];
  let mark = started;
  const phase = (name: string): void => {
    const now = Date.now();
    phases.push(name + ';dur=' + (now - mark));
    mark = now;
  };
    const [orders, settings] = await Promise.all([generalOrders(user), ensureSettings()]);
    phase('orders');
    orders.sort((a, b) => String(b.orderNo).localeCompare(String(a.orderNo), undefined, { numeric: true }));
    const keys = orders.map((o) => S.normalizeBookingKey(o.orderNo));
    const canSetUnits = S.can(user, 'menus.dataManagement.unitSetup');
    const [plans, bpRows, cardDocs, { usedKeys, keysByOrder, orderDateByNo }, units, buyers] = await Promise.all([
      BatchPlan.find({ orderKey: { $in: keys } }).lean(),
      BatchBpData.find({ orderKey: { $in: keys } }).lean(),
      BatchCard.find({ orderKey: { $in: keys } }).lean(),
      orderUnits(orders, PLAN_DATE_FIELDS),
      unitOptions(),
      canSetUnits ? buyerNames() : Promise.resolve([] as string[]),
    ]);
    phase('plans');
    const planByKey = new Map(plans.map((p) => [p.orderKey, p]));
    const settingMap: Record<string, LeanDoc> = Object.fromEntries(settings.map((s) => [s.key, s]));
    const master: LeanDoc[] = [];
    const planVersions: Record<string, number> = {};
    const genInfo: Record<string, LeanDoc> = {};
    const knitPlan: Record<string, LeanDoc[]> = {};
    const bpData: Record<string, LeanDoc[]> = {};
    for (const order of orders) {
      const key = S.normalizeBookingKey(order.orderNo);
      const plan = planByKey.get(key);
      let state: any = {};
      if (plan) {
        try {
          state = JSON.parse(plan.stateJson || '{}');
        } catch {
          state = {};
        }
      }
      master.push({ ...S.bookingFromOrder(order, S.modulePlanDates(orderDateByNo.get(order.orderNo))), ...state });
      planVersions[order.orderNo] = plan ? plan.version : 0;
      genInfo[order.orderNo] = { OrderNo: order.orderNo, Buyer: order.buyer || '' };
      // A unit with a confirmed plan keeps its page even when no row is on it now: the page keeps such an
      // order on that unit through its confirmed snapshot rows, so it can still be opened.
      for (const unit of S.planRetainedUnits(state)) if (!usedKeys.has(unit)) usedKeys.set(unit, unit);
      // Each knitting row's floor = the unit the Dyeing Plan shows for its colour.
      const rowKeys = keysByOrder.get(order.orderNo);
      if (rowKeys)
        knitPlan[order.orderNo] = S.knittingRowsForDemo(order.knittingItems, (_row, index) =>
          rowKeys[index] ? S.unitRowText(rowKeys[index]) : ''
        );
    }
    const orderNoByKey = new Map(orders.map((o) => [S.normalizeBookingKey(o.orderNo), o.orderNo]));
    for (const doc of bpRows) {
      const orderNo = orderNoByKey.get(doc.orderKey) || doc.orderNo;
      (bpData[orderNo] = bpData[orderNo] || []).push(doc.row || {});
    }
    const cards: any[] = [];
    for (const doc of cardDocs) {
      try {
        cards.push(JSON.parse(doc.cardJson));
      } catch {
        /* skip damaged record */
      }
    }
    // A unit that still has a batch card that is not superseded keeps its page, so the card stays reachable.
    for (const card of cards) {
      const unit = S.cardRetainedUnit(card);
      if (unit && !usedKeys.has(unit)) usedKeys.set(unit, unit);
    }
    const batchUnits = S.orderedUnits(usedKeys, units);
    phase('build');
    const viewer: any = user || {};
    const body = JSON.stringify({
      user: { username: viewer.username, role: viewer.role, permissions: viewer.permissions || {} },
      master,
      planVersions,
      datasets: { genInfo, knitPlan, bpData },
      setup: settingMap.setup?.value || [],
      flatAllowance: settingMap.flatAllowance?.value || [],
      unitSetup: settingMap.unitSetup?.value || [],
      settingVersions: {
        setup: settingMap.setup?.version || 0,
        flatAllowance: settingMap.flatAllowance?.version || 0,
        unitSetup: settingMap.unitSetup?.version || 0,
      },
      cards,
      // The unit tabs in the page heading, [{key, label}].
      batchUnits,
      // Unit Setup page: the Dropdown Master units and the buyers of the latest uploaded files (buyers only for
      // users who can edit Unit Setup).
      units,
      buyers,
    });
    phase('json');
    phases.push(
      'total;dur=' + (Date.now() - started),
      'orders-count;desc="' + orders.length + ' orders, ' + Math.round(body.length / 1024) + ' KB"'
    );
    return { body, serverTiming: phases.join(', ') };
  }

  /**
   * Saves changed plans, Setup tables and batch cards after validating every one of them.
   * Body: { plans:[{orderNo, version, state}], settings:{key:{value, version}}, cards:[card] }.
   * Throws HttpError 400 (invalid data), 403 (code PERMISSION) or 409 (code CONFLICT).
   */
  static async commit(user: BatchUser, body: any): Promise<{ planVersions: Record<string, number>; settingVersions: Record<string, number> }> {
    const plans: any[] = Array.isArray(body?.plans) ? body.plans : [];
    const settings: Record<string, any> = body?.settings && typeof body.settings === 'object' ? body.settings : {};
    const cards: any[] = Array.isArray(body?.cards) ? body.cards : [];
    const username = user?.username || '';
    if (plans.length > MAX_PLANS_PER_SAVE || cards.length > MAX_CARDS_PER_SAVE) {
      throw new HttpError(400, 'Too many changes in one save.');
    }
    const deny = (path: string): HttpError =>
      new HttpError(403, 'You do not have permission to ' + (ACTION_LABELS[path] || 'change this Setup table') + '.', 'PERMISSION');
    const conflict = (message: string): HttpError => new HttpError(409, message, 'CONFLICT');
    const planConflictText = (orderNo: string): string =>
      'Order ' + orderNo + ' was changed by another user. Reload the page to see the latest plan.';
    const settingConflictText = 'This Setup table was changed by another user. Reload the page to see the latest values.';

    // ---- validate everything before writing anything ----
    const buyers = await allowedBuyerSet(user);
    const orderCache = new Map<string, LeanDoc | null>();
    const findOrder = async (orderNo: string): Promise<LeanDoc | null> => {
      if (!orderCache.has(orderNo)) orderCache.set(orderNo, await Order.findOne({ orderNo }, { knittingItems: 0 }).lean());
      return orderCache.get(orderNo) || null;
    };
    const noOrderAccess = (orderNo: unknown): HttpError => new HttpError(403, 'You do not have access to order ' + orderNo + '.', 'PERMISSION');
    const noFloorAccess = (group: string, floor: string | null): HttpError =>
      new HttpError(
        403,
        floor
        ? 'You do not have access to the ' + floor + ' ' + (group === 'batchCard' ? 'batch cards' : 'batch plan') + '.'
        : 'Only users with the all-orders ' + (group === 'batchCard' ? 'Batch Card' : 'Batch Plan') + ' permission can change this.',
        'PERMISSION'
      );

    const planWrites: { orderNo: string; orderKey: string; existing: LeanDoc | null; newState: LeanDoc; version: number }[] = [];
    for (const plan of plans) {
      const orderNo = String(plan?.orderNo ?? '').trim();
      const orderKey = S.normalizeBookingKey(orderNo);
      if (!orderNo || !plan.state || typeof plan.state !== 'object' || Array.isArray(plan.state)) {
        throw new HttpError(400, 'Invalid plan data.');
      }
      const floorError = S.floorPlansError(plan.state);
      if (floorError) {
        throw new HttpError(400, floorError);
      }
      const order = await findOrder(orderNo);
      if (buyers && (!order || !buyers.has(order.buyer))) {
        throw noOrderAccess(orderNo);
      }
      const existing = await BatchPlan.findOne({ orderKey }).lean();
      const currentVersion = existing ? existing.version : 0;
      if (Number(plan.version) !== currentVersion) {
        throw conflict(planConflictText(orderNo));
      }
      // Before the first save, compare with what GET /state sent (bookingFromOrder defaults), not with nothing.
      let oldState: LeanDoc = order ? S.planStateFromBooking(S.bookingFromOrder(order)) : {};
      if (existing) {
        try {
          oldState = JSON.parse(existing.stateJson || '{}');
        } catch {
          oldState = {};
        }
      }
      const newState = S.planStateFromBooking(plan.state);
      const { required, touchedScopes } = S.planChangePermissions(oldState, newState);
      for (const floor of touchedScopes) {
        if (!S.canUseFloor(user, 'batchPlan', floor)) {
          throw noFloorAccess('batchPlan', floor);
        }
      }
      for (const path of required) {
        if (!S.can(user, path)) {
          throw deny(path);
        }
      }
      planWrites.push({ orderNo, orderKey, existing, newState, version: currentVersion });
    }

    const settingWrites: { key: BatchSettingKey; value: any[]; version: number }[] = [];
    for (const [rawKey, entry] of Object.entries(settings)) {
      const key = rawKey as BatchSettingKey;
      if (!Object.prototype.hasOwnProperty.call(SETTING_PERMISSIONS, key)) {
        throw new HttpError(400, 'Unknown Setup table.');
      }
      if (!S.can(user, SETTING_PERMISSIONS[key])) {
        throw deny(SETTING_PERMISSIONS[key]);
      }
      if (!Array.isArray(entry?.value)) {
        throw new HttpError(400, 'Invalid Setup data.');
      }
      const existing = await BatchSetting.findOne({ key }).lean();
      if ((existing?.version || 0) !== Number(entry.version)) {
        throw conflict(settingConflictText);
      }
      if (key === 'unitSetup') {
        const activeUnits = (await unitOptions()).filter((unit) => unit.status === 'ACTIVE').map((unit) => unit.name);
        const unitError = S.unitSetupError(entry.value, existing?.value || [], activeUnits);
        if (unitError) {
          throw new HttpError(400, unitError);
        }
      }
      settingWrites.push({ key, value: entry.value, version: existing?.version || 0 });
    }

    if (cards.length && !S.can(user, 'actions.batchCardGenerate')) {
      throw deny('actions.batchCardGenerate');
    }
    for (const card of cards) {
      if (!card || typeof card !== 'object' || typeof card.id !== 'string') {
        throw new HttpError(400, 'Invalid batch card data.');
      }
      // The id must be the one the page builds from (order, floor, batch), so a card cannot replace another order's card.
      if (card.id !== S.cardKey(card.number, card.floor, card.batchId)) {
        throw new HttpError(400, 'Invalid batch card id.');
      }
      if (!S.canUseFloor(user, 'batchCard', card.floor)) {
        throw noFloorAccess('batchCard', card.floor);
      }
      if (buyers) {
        const order = await findOrder(String(card.number ?? '').trim());
        if (!order || !buyers.has(order.buyer)) {
          throw noOrderAccess(card.number);
        }
      }
    }

    // ---- write (optimistic version checks again at write time) ----
    const planVersions: Record<string, number> = {};
    const settingVersions: Record<string, number> = {};
    for (const write of planWrites) {
      const stateJson = JSON.stringify(write.newState);
      // The units this plan keeps in the unit list, for GET /units (retainedUnits above).
      const retained = { retainedUnits: S.planRetainedUnits(write.newState), retainedVersion: write.version + 1 };
      if (write.existing) {
        const result = await BatchPlan.updateOne(
          { orderKey: write.orderKey, version: write.version },
          { $set: { stateJson, orderNo: write.orderNo, updatedBy: username, ...retained }, $inc: { version: 1 } }
        );
        if (!result.matchedCount) {
          throw conflict(planConflictText(write.orderNo));
        }
      } else {
        try {
          await BatchPlan.create({
            orderKey: write.orderKey,
            orderNo: write.orderNo,
            stateJson,
            version: 1,
            updatedBy: username,
            ...retained,
          });
        } catch (error: any) {
          if (error.code === 11000) {
            throw conflict(planConflictText(write.orderNo));
          }
          throw error;
        }
      }
      planVersions[write.orderNo] = write.version + 1;
    }
    for (const write of settingWrites) {
      const result = await BatchSetting.updateOne(
        { key: write.key, version: write.version },
        { $set: { value: write.value, updatedBy: username }, $inc: { version: 1 } }
      );
      if (!result.matchedCount) {
        throw conflict(settingConflictText);
      }
      settingVersions[write.key] = write.version + 1;
    }
    for (const card of cards) {
      await BatchCard.updateOne(
        { cardId: card.id },
        {
          $set: {
            cardJson: JSON.stringify(card),
            orderKey: S.normalizeBookingKey(card.number),
            updatedBy: username,
            retainedUnit: S.cardRetainedUnit(card),
          },
        },
        { upsert: true }
      );
    }
    return { planVersions, settingVersions };
  }
}
