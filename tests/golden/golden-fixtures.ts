import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { LOCAL_MONGO, assertLocalUri, rawCollection } from '../helpers/local-mongo.js';

/**
 * Real orders for the golden-master tests.
 *
 * They are copied, READ ONLY, from `abir_test` on the local test MongoDB (a restored copy of the live database) and
 * kept in tests/golden/local/, which is gitignored because it holds real data. Selection is deterministic (newest
 * order numbers first), so a fresh extraction from the same restore gives the same orders. Documents are stored as
 * canonical Extended JSON, so every BSON type (Int32, Double, Date, ObjectId) survives the copy exactly.
 */

const { EJSON } = mongoose.mongo.BSON;

export const LOCAL_DIR = fileURLToPath(new URL('./local/', import.meta.url));
const FIXTURE_FILE = fileURLToPath(new URL('./local/golden-fixtures.json', import.meta.url));
const SOURCE_DB = 'abir_test';

export const PLAN_DEPTS = ['yd', 'knitting', 'dyeing', 'finishing', 'delivery'] as const;

export interface GoldenOrder {
  /** Why this order was picked. */
  label: string;
  orderNo: string;
  /** Departments the scripted saves exercise on this order. */
  departments: string[];
  /** The Order document (canonical EJSON), or null for a plan without an order. */
  order: Record<string, unknown> | null;
  /** The OrderDate document (canonical EJSON), or null when the order has no saved plan yet. */
  orderDate: Record<string, unknown> | null;
}

export interface GoldenFixtures {
  source: string;
  orders: GoldenOrder[];
}

interface Pick {
  label: string;
  count: number;
  departments: string[];
  kind: 'plan' | 'noPlan' | 'planWithoutOrder';
  filter?: Record<string, unknown>;
}

// 13 real orders across the departments. Finishing has no real data in the restore, so its saves reuse the
// Dyeing rows of the 'dyeing-unit-process' orders.
const PICKS: Pick[] = [
  {
    label: 'knitting-tentative',
    kind: 'plan',
    count: 1,
    departments: ['knitting', 'dyeing'],
    filter: { 'knitting.0': { $exists: true }, knittingStatus: 'On Process', 'knitting.planType': 'Tentative' },
  },
  {
    label: 'knitting-completed',
    kind: 'plan',
    count: 1,
    departments: ['knitting'],
    filter: { 'knitting.0': { $exists: true }, knittingStatus: 'Completed' },
  },
  {
    label: 'dyeing-unit-process',
    kind: 'plan',
    count: 2,
    departments: ['dyeing', 'finishing'],
    filter: { 'dyeing.0': { $exists: true }, 'dyeing.itemData.Unit': { $exists: true, $nin: ['', null] } },
  },
  {
    label: 'dyeing-item-level-unit',
    kind: 'plan',
    count: 1,
    departments: ['dyeing'],
    filter: { 'dyeing.Unit': { $exists: true } },
  },
  {
    label: 'delivery-floor',
    kind: 'plan',
    count: 2,
    departments: ['delivery'],
    filter: { 'delivery.0': { $exists: true }, 'delivery.floorPlanType': { $in: ['Confirm', 'Tentative'] } },
  },
  {
    label: 'delivery-no-floor',
    kind: 'plan',
    count: 1,
    departments: ['delivery'],
    filter: { 'delivery.0': { $exists: true }, 'delivery.floorPlanType': { $exists: false } },
  },
  { label: 'yd', kind: 'plan', count: 2, departments: ['yd'], filter: { 'yd.0': { $exists: true } } },
  { label: 'no-plan-yet', kind: 'noPlan', count: 2, departments: ['knitting', 'delivery'] },
  { label: 'plan-without-order', kind: 'planWithoutOrder', count: 1, departments: ['knitting'] },
];

const RAW_READ = { promoteValues: false, promoteLongs: false } as const;

async function extractFromSource(sourceDb: string): Promise<GoldenFixtures | null> {
  assertLocalUri(LOCAL_MONGO);
  const client = new mongoose.mongo.MongoClient(LOCAL_MONGO, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
  } catch {
    return null;
  }
  try {
    const db = client.db(sourceDb);
    if (!(await db.listCollections({ name: 'orderdates' }).hasNext())) return null;
    const orderDates = db.collection('orderdates');
    const orders = db.collection('orders');
    const taken = new Set<string>();
    const picked: GoldenOrder[] = [];
    const toEjson = (doc: unknown) => (doc ? (EJSON.serialize(doc, { relaxed: false }) as Record<string, unknown>) : null);

    for (const pick of PICKS) {
      let found = 0;
      if (pick.kind === 'plan') {
        const cursor = orderDates.find(pick.filter || {}, RAW_READ).sort({ orderNo: -1 });
        for await (const od of cursor) {
          const orderNo = String(od.orderNo);
          if (taken.has(orderNo)) continue;
          const order = await orders.findOne({ orderNo }, RAW_READ);
          if (!order) continue;
          taken.add(orderNo);
          picked.push({ label: pick.label, orderNo, departments: pick.departments, order: toEjson(order), orderDate: toEjson(od) });
          if (++found >= pick.count) break;
        }
      } else if (pick.kind === 'noPlan') {
        const rows = await orders
          .aggregate([
            { $match: { 'knittingItems.0': { $exists: true }, 'deliveryItems.0': { $exists: true } } },
            { $sort: { orderNo: -1 } },
            { $lookup: { from: 'orderdates', localField: 'orderNo', foreignField: 'orderNo', as: 'plans' } },
            { $match: { plans: { $size: 0 } } },
            { $limit: 10 },
            { $project: { orderNo: 1 } },
          ])
          .toArray();
        for (const row of rows) {
          const orderNo = String(row.orderNo);
          if (taken.has(orderNo)) continue;
          const order = await orders.findOne({ orderNo }, RAW_READ);
          taken.add(orderNo);
          picked.push({ label: pick.label, orderNo, departments: pick.departments, order: toEjson(order), orderDate: null });
          if (++found >= pick.count) break;
        }
      } else {
        const rows = await orderDates
          .aggregate([
            { $match: { 'knitting.0': { $exists: true } } },
            { $sort: { orderNo: -1 } },
            { $lookup: { from: 'orders', localField: 'orderNo', foreignField: 'orderNo', as: 'order' } },
            { $match: { order: { $size: 0 } } },
            { $limit: 10 },
            { $project: { orderNo: 1 } },
          ])
          .toArray();
        for (const row of rows) {
          const orderNo = String(row.orderNo);
          if (taken.has(orderNo)) continue;
          const od = await orderDates.findOne({ orderNo }, RAW_READ);
          taken.add(orderNo);
          picked.push({ label: pick.label, orderNo, departments: pick.departments, order: null, orderDate: toEjson(od) });
          if (++found >= pick.count) break;
        }
      }
      if (found < pick.count) {
        throw new Error(`Golden fixtures: only ${found} of ${pick.count} '${pick.label}' orders found in ${sourceDb}.`);
      }
    }
    return { source: `${sourceDb} on the local test MongoDB`, orders: picked };
  } finally {
    await client.close();
  }
}

/**
 * The golden orders: read from tests/golden/local, or extracted from abir_test (read only) on first use.
 * Returns null when neither is available (another machine without the local restore); the golden tests then skip.
 * `fixtureFile` and `sourceDb` are for the harness's own tests only.
 */
export async function loadGoldenFixtures(
  options: { fixtureFile?: string; sourceDb?: string } = {}
): Promise<GoldenFixtures | null> {
  const fixtureFile = options.fixtureFile ?? FIXTURE_FILE;
  if (existsSync(fixtureFile)) {
    return JSON.parse(readFileSync(fixtureFile, 'utf8')) as GoldenFixtures;
  }
  const fixtures = await extractFromSource(options.sourceDb ?? SOURCE_DB);
  if (!fixtures) return null;
  mkdirSync(dirname(fixtureFile), { recursive: true });
  const tmp = `${fixtureFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(fixtures, null, 1));
  renameSync(tmp, fixtureFile);
  return fixtures;
}

/** Inserts the golden Order and OrderDate documents into the current test database, with their exact BSON types. */
export async function seedGoldenOrders(fixtures: GoldenFixtures): Promise<void> {
  const orders = fixtures.orders.filter((o) => o.order).map((o) => EJSON.deserialize(o.order!, { relaxed: false }));
  const orderDates = fixtures.orders.filter((o) => o.orderDate).map((o) => EJSON.deserialize(o.orderDate!, { relaxed: false }));
  if (orders.length) await rawCollection('orders').insertMany(orders);
  if (orderDates.length) await rawCollection('orderdates').insertMany(orderDates);
}

/** A golden recording: compared, and written only with GOLDEN_RECORD=1. */
export function goldenFile(name: string): string {
  return fileURLToPath(new URL(`./local/${name}`, import.meta.url));
}

/**
 * The recorded text to compare with, or null with GOLDEN_RECORD=1 (the test then records the current behaviour).
 * The golden tests call it only when the real-data fixtures exist (without them and without abir_test they skip).
 * A missing recording FAILS instead of being recorded: a recording must come from the code before a change, and
 * recording it silently from changed code would hide that change.
 */
export function readGolden(file: string): string | null {
  if (process.env.GOLDEN_RECORD === '1') return null;
  if (!existsSync(file)) {
    throw new Error(
      `Golden recording missing: ${file}. The golden fixtures exist, so this test compares with a recording and never ` +
        'records one silently. Record it on purpose, from code whose behaviour is the reference, by running the ' +
        'golden tests with GOLDEN_RECORD=1 (e.g. GOLDEN_RECORD=1 npx vitest run tests/golden).'
    );
  }
  return readFileSync(file, 'utf8');
}

export function writeGolden(file: string, text: string): void {
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(file, text);
}
