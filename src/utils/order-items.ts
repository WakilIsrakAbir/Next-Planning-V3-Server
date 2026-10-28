/**
 * Helpers for department item rows (raw Excel upload rows stored in `Order.<dept>Items`
 * and `OrderDate.<dept>[].itemData`). Ported from the legacy backend (routes/orders.js).
 */

type Row = Record<string, any>;

/**
 * Builds a field getter for a raw row: exact key match first (non-empty values only),
 * then a case/punctuation-insensitive key match.
 */
function makeFieldGetter(rawItem: Row): (keys: string[]) => any {
  const rawKeys = Object.keys(rawItem);
  return (keys: string[]) => {
    // Direct key match first
    for (const k of keys) {
      if (rawItem[k] !== undefined && rawItem[k] !== null && rawItem[k] !== '') return rawItem[k];
    }
    // Case-insensitive fuzzy match
    for (const k of keys) {
      const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      const found = rawKeys.find((rk) => rk.toLowerCase().replace(/[^a-z0-9]/g, '') === normK);
      if (found && rawItem[found] !== undefined && rawItem[found] !== null) return rawItem[found];
    }
    return '';
  };
}

// Column alias lists shared across departments
const ORDER_NO_KEYS = ['OrderNo', 'BookingNo', 'EWO', 'Booking', 'Order No', 'Booking No'];
const BUYER_KEYS = ['Buyer', 'BuyerName', 'Customer'];
const COLOR_KEYS = ['Color', 'Colour', 'Fab Color'];
const FABRIC_KEYS = ['FabricConstruction', 'Construction', 'Fab Const', 'Fabric'];
const GSM_KEYS = ['GSM', 'G.S.M'];
const REQ_QTY_KEYS = ['RequiredQtyKgs', 'Req Qty', 'Qty', 'Order Qty'];
const ALLOWANCE_KEYS = ['Allowance %', 'Allowance', 'Wastage %', 'Wastage', 'Allow %', 'Allow'];
const YARN_REQ_KEYS = ['Yarn req.', 'YarnReq', 'Yarn Req', 'Yarn Req.'];
const ALLOC_QTY_KEYS = ['Allocated Qty', 'Allocated Qty ', 'AllocatedQty', 'Alloc Qty'];
const YARN_BAL_KEYS = ['Yarn bala.', 'YarnBala', 'Yarn Bala', 'Yarn Balance'];
const GREY_REQ_KEYS = ['Grey Req.', 'GreyReq', 'Grey Req'];
const KNIT_PROD_KEYS = ['Knit Prod.', 'KnitProd', 'Knit Prod', 'Knit Production'];
const KNIT_BAL_KEYS = ['Knit. Bala.', 'KnitBala', 'Knit Bala.', 'Knit Bala', 'Knit. Bal.'];
const NET_RECEIVED_KEYS = ['NetReceivedQtyKgs', 'NetReceivedQty', 'ReceivedQty'];
const NET_DELIVERY_KEYS = ['NetDeliveryQtyKgs', 'NetDeliveryQty', 'DeliveryQty'];
const DELI_BAL_KEYS = ['Deli. Bal.', 'Deli Bal.', 'DeliBal', 'Delivery Balance', 'Deli. Bala.'];
const FF_STOCK_KEYS = ['FF Stock', 'FFStock', 'FF_Stock'];
const BP_QTY_KEYS = ['BP Qty', 'BPQty', 'BP_Qty'];
const DYEING_PROD_KEYS = ['Dyeing Prod.', 'DyeingProd', 'Dyeing Prod', 'Dyeing ok', 'Dyeing Production'];
const DYEING_BAL_KEYS = ['Dyeing Bala.', 'DyeingBala', 'Dyeing Bala', 'Dyeing Bal.'];

/**
 * Normalizes a raw Excel item row to the consistent column keys used by the
 * department report download. The key order of the returned object defines the
 * Excel column order, so it must stay identical to the legacy backend.
 */
export function normalizeItemRow(rawItem: Row, dept: string): Row {
  const getField = makeFieldGetter(rawItem || {});

  if (dept === 'delivery') {
    return {
      OrderNo: getField(ORDER_NO_KEYS),
      Buyer: getField(BUYER_KEYS),
      Color: getField(COLOR_KEYS),
      FabricConstruction: getField(FABRIC_KEYS),
      GSM: getField(GSM_KEYS),
      RequiredQtyKgs: getField(REQ_QTY_KEYS),
      Allowance: getField(ALLOWANCE_KEYS),
      YarnReq: getField(YARN_REQ_KEYS),
      AllocatedQty: getField(ALLOC_QTY_KEYS),
      YarnBala: getField(YARN_BAL_KEYS),
      GreyReq: getField(GREY_REQ_KEYS),
      KnitProd: getField(KNIT_PROD_KEYS),
      KnitBala: getField(KNIT_BAL_KEYS),
      NetReceivedQtyKgs: getField(NET_RECEIVED_KEYS),
      NetDeliveryQtyKgs: getField(NET_DELIVERY_KEYS),
      DeliBal: getField(DELI_BAL_KEYS),
      RFD: getField(['RFD']),
      Slowmoving: getField(['Slowmoving']),
      FFStock: getField(FF_STOCK_KEYS),
      BPQty: getField(BP_QTY_KEYS),
      DyeingProd: getField(DYEING_PROD_KEYS),
      DyeingBala: getField(DYEING_BAL_KEYS),
    };
  } else if (dept === 'knitting') {
    return {
      OrderNo: getField(ORDER_NO_KEYS),
      Buyer: getField(BUYER_KEYS),
      Color: getField(COLOR_KEYS),
      FabricConstruction: getField(FABRIC_KEYS),
      GSM: getField(GSM_KEYS),
      RequiredQtyKgs: getField(REQ_QTY_KEYS),
      Allowance: getField(ALLOWANCE_KEYS),
      YarnReq: getField(YARN_REQ_KEYS),
      AllocatedQty: getField(ALLOC_QTY_KEYS),
      YarnBala: getField(YARN_BAL_KEYS),
      GreyReq: getField(GREY_REQ_KEYS),
      KnitProd: getField(KNIT_PROD_KEYS),
      KnitBala: getField(KNIT_BAL_KEYS),
      NetReceivedQtyKgs: getField(NET_RECEIVED_KEYS),
      NetDeliveryQtyKgs: getField(NET_DELIVERY_KEYS),
      DeliBal: getField(DELI_BAL_KEYS),
      RFD: getField(['RFD']),
      Slowmoving: getField(['Slowmoving']),
      FFStock: getField(FF_STOCK_KEYS),
    };
  } else if (dept === 'dyeing' || dept === 'finishing') {
    return {
      OrderNo: getField(ORDER_NO_KEYS),
      Color: getField(COLOR_KEYS),
      RequiredQtyKgs: getField(REQ_QTY_KEYS),
      Buyer: getField(BUYER_KEYS),
      Unit: getField(['Unit']),
      ProcessName: getField(['Process Name', 'ProcessName', 'Process']),
      Allowance: getField(ALLOWANCE_KEYS),
      YarnReq: getField(YARN_REQ_KEYS),
      AllocatedQty: getField(ALLOC_QTY_KEYS),
      YarnBala: getField(YARN_BAL_KEYS),
      GreyReq: getField(GREY_REQ_KEYS),
      KnitProd: getField(KNIT_PROD_KEYS),
      KnitBala: getField(KNIT_BAL_KEYS),
      BPQty: getField(BP_QTY_KEYS),
      DyeingProd: getField(DYEING_PROD_KEYS),
      DyeingBala: getField(DYEING_BAL_KEYS),
      NetReceivedQtyKgs: getField(NET_RECEIVED_KEYS),
      NetDeliveryQtyKgs: getField(NET_DELIVERY_KEYS),
      DeliBal: getField(DELI_BAL_KEYS),
      RFD: getField(['RFD']),
      Slowmoving: getField(['Slowmoving']),
      FFStock: getField(FF_STOCK_KEYS),
    };
  } else if (dept === 'yd') {
    return {
      OrderNo: getField(ORDER_NO_KEYS),
      'Booking Type': getField(['Booking Type', 'Type', 'YD Type']),
      YDB: getField(['YDB', 'YD B']),
      'YD Booking Date': getField(['YD Booking Date', 'Date', 'Booking Date']),
      'YD T&A Start': getField([
        'YD T&A Start',
        'T&A Start',
        'YD T&A Start Date',
        'YD TNA Start',
        'TNA Start',
        'Start Date',
      ]),
      'YD T&A End': getField(['YD T&A End', 'T&A End', 'YD T&A End Date', 'YD TNA End', 'TNA End', 'End Date']),
      Buyer: getField(BUYER_KEYS),
      'YD REQ.': getField(['YD REQ.', 'YD REQ', 'YD Req', 'Requirement']),
      DYED: getField(['DYED', 'Dyed', 'Dye']),
      'YD BALANCE': getField(['YD BALANCE', 'YD Balance']),
      'YD Delivered': getField(['YD Delivered', 'Delivered', 'Delivery']),
      'YD DELIVERY BALANCE': getField(['YD DELIVERY BALANCE', 'YD Balance_1', 'YD Balance 2']),
      'Barrier Qty.': getField(['Barrier Qty.', 'Barrier Qty', 'Barrier']),
      'Workable Qty.': getField(['Workable Qty.', 'Workable Qty', 'Workable']),
    };
  }
  return { ...(rawItem || {}) }; // fallback: unknown department, keep raw columns
}

/** Lower-cased, trimmed string form used for colour / construction / GSM / process matching. */
export function matchKey(val: any): string {
  return String(val || '')
    .trim()
    .toLowerCase();
}

/** True when a normalized field carries a value (legacy rule: not undefined and not ""). */
export function hasValue(val: any): boolean {
  return val !== undefined && val !== '';
}

/** Copies each listed field from `src` into `row` when `src` has a value for it (overwrites). */
export function copyFields(row: Row, src: Row, fields: string[]): void {
  for (const f of fields) {
    if (hasValue(src[f])) row[f] = src[f];
  }
}

/** Copies each listed field from `src` into `row` only when `row` has no value for it yet. */
export function fillMissingFields(row: Row, src: Row, fields: string[]): void {
  for (const f of fields) {
    if ((row[f] === undefined || row[f] === '') && hasValue(src[f])) row[f] = src[f];
  }
}
