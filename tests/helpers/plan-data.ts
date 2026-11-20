import mongoose from 'mongoose';
import { Order } from '../../src/models/Order.model.js';
import { rawCollection } from './local-mongo.js';

/** Synthetic orders and plan rows (no real data), shaped like what the order page and the uploads store. */

export type Dept = 'yd' | 'knitting' | 'dyeing' | 'finishing' | 'delivery';

const { EJSON } = mongoose.mongo.BSON;

/** Excel rows of an order, per department. */
export function excelRows(orderNo: string, dept: Dept, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const color = ['NAVY', 'RED', 'ECRU', 'BLACK'][i % 4];
    if (dept === 'yd') return { 'Booking No.': orderNo, 'Booking Type': 'Main', YDB: `YDB-${i + 1}`, 'YD REQ.': 100 + i };
    if (dept === 'dyeing' || dept === 'finishing') {
      return { OrderNo: orderNo, Color: color, ProcessName: 'Normal Wash', 'Process Name': 'Normal Wash', Unit: 'Unit-1', RequiredQtyKgs: 200 + i, DyeingProd: 10 * i };
    }
    return { OrderNo: orderNo, Color: color, FabricConstruction: 'S/J', GSM: 160 + i, RequiredQtyKgs: 300 + i, KnitProd: 5 * i };
  });
}

/** Plan rows as the order page sends them for a department (save-dates `fabricItems`). */
export function planRows(
  orderNo: string,
  dept: Dept,
  count: number,
  planType = 'Confirm',
  extra: Record<string, unknown> = {}
): Record<string, any>[] {
  return excelRows(orderNo, dept, count).map((row, i) => ({
    itemId: `${orderNo}_${dept}_${i}`.toLowerCase(),
    itemData: row,
    planType,
    startDate: `2026-12-0${(i % 8) + 1}`,
    endDate: '2026-12-15',
    limitation: '',
    remarks: '',
    ...(dept === 'delivery' ? { floorStartDate: '2026-12-03', floorEndDate: '2026-12-12', floorPlanType: 'Tentative' } : {}),
    ...(dept === 'yd' ? { yarnDate: '2026-11-25', barrierQty: '', workableQty: '' } : {}),
    ...(dept === 'dyeing' || dept === 'finishing' ? { unit: 'Unit-1', processName: 'Normal Wash' } : {}),
    ...extra,
  }));
}

/** Inserts an Order (as a General + department upload would store it) through the Mongoose model, with its defaults. */
export async function insertOrder(orderNo: string, itemCounts: Partial<Record<Dept, number>> = { knitting: 2, dyeing: 2, delivery: 2 }) {
  const doc: Record<string, unknown> = {
    orderNo,
    buyer: 'V3T BUYER',
    bookingDate: '2026-11-01',
    knitStart: '2026-12-01',
    knitEnd: '2026-12-15',
    dyeStart: '2026-12-10',
    dyeEnd: '2026-12-20',
    deliStart: '2026-12-21',
    deliEnd: '2026-12-31',
  };
  for (const [dept, count] of Object.entries(itemCounts)) doc[`${dept}Items`] = excelRows(orderNo, dept as Dept, count as number);
  await Order.create(doc);
}

const STAMPS = ['_id', 'createdAt', 'updatedAt'];

/** The stored OrderDate and Order of an order, raw (exact BSON types), without _id and timestamps, as canonical EJSON. */
export async function storedDocs(orderNo: string): Promise<{ orderDates: number; orderDate: any; order: any }> {
  const read = { promoteValues: false, promoteLongs: false } as const;
  const orderDates = await rawCollection('orderdates').find({ orderNo }, read).toArray();
  const order = await rawCollection('orders').findOne({ orderNo }, read);
  const strip = (doc: Record<string, any> | null) => {
    if (!doc) return null;
    const copy: Record<string, any> = {};
    for (const [k, v] of Object.entries(doc)) if (!STAMPS.includes(k)) copy[k] = v;
    return EJSON.serialize(copy, { relaxed: false });
  };
  return { orderDates: orderDates.length, orderDate: strip(orderDates[0] || null), order: strip(order) };
}

/** A copy of a plain object with its keys sorted at every level, for comparisons that ignore key order. */
export function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])])
    );
  }
  return value;
}
