import mongoose, { Model, Schema } from 'mongoose';

/** The guide's ten dates: 'YYYY-MM-DD', or '' for an empty cell. */
export interface IGuideDates {
  ydStart: string;
  ydEnd: string;
  knitStart: string;
  knitEnd: string;
  dyeStart: string;
  dyeEnd: string;
  floorStart: string;
  floorEnd: string;
  lockStart: string;
  lockEnd: string;
}

/**
 * The checklist lead time added to the Knit T&A dates: the largest startDays and, separately, the largest endDays of
 * the Active criteria set to Yes (per-column maxima, never sums). `startFrom` / `endFrom` name the criteria holding
 * each maximum, and `startFromIds` / `endFromIds` are their ids in the same order.
 */
export interface IGuideLead {
  startDays: number;
  endDays: number;
  startFrom: string[];
  endFrom: string[];
  startFromIds: string[];
  endFromIds: string[];
}

/** A Plan Check List criterion as it was when the guide was saved. */
export interface IGuideCheck {
  id: string;
  name: string;
  startDays: number;
  endDays: number;
  active: boolean;
}

/** The order's General-file T&A values when the guide was saved, raw (as stored on the Order). */
export interface IGuideTna {
  yarnDate: string;
  knitStart: string;
  knitEnd: string;
  dyeStart: string;
  dyeEnd: string;
  deliStart: string;
  deliEnd: string;
}

/**
 * The Checkpoint & Planning Guide of one order (V3 only; V2 never reads this collection). It never changes plan
 * rows, the Order's T&A fields or any validation. The _id is the order number, so an order has at most one guide
 * without needing a unique index (autoIndex is off on Vercel).
 */
export interface IOrderPlanGuide {
  _id: string;
  orderNo: string;
  /** Ids of the criteria set to Yes; a criterion that is not listed is No. */
  yesIds: string[];
  dates: IGuideDates;
  lead: IGuideLead;
  /** The Plan Check List at save time (plus, inactive, any Yes criterion it no longer has, to keep its name). */
  checks: IGuideCheck[];
  tna: IGuideTna;
  /** The Plan Check List version the lead was computed from. */
  checklistVersion: number;
  /** Goes up by one on every save (optimistic locking); `__v` is not used. */
  version: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const text = { type: String, default: '' };

const guideCheckSchema = new Schema<IGuideCheck>(
  {
    id: { type: String, required: true },
    name: text,
    startDays: { type: Number, default: 0 },
    endDays: { type: Number, default: 0 },
    active: { type: Boolean, default: false },
  },
  { _id: false }
);

const orderPlanGuideSchema = new Schema<IOrderPlanGuide>(
  {
    _id: { type: String, required: true },
    orderNo: { type: String, required: true },
    yesIds: { type: [String], default: [] },
    dates: {
      ydStart: text,
      ydEnd: text,
      knitStart: text,
      knitEnd: text,
      dyeStart: text,
      dyeEnd: text,
      floorStart: text,
      floorEnd: text,
      lockStart: text,
      lockEnd: text,
    },
    lead: {
      startDays: { type: Number, default: 0 },
      endDays: { type: Number, default: 0 },
      startFrom: { type: [String], default: [] },
      endFrom: { type: [String], default: [] },
      startFromIds: { type: [String], default: [] },
      endFromIds: { type: [String], default: [] },
    },
    checks: { type: [guideCheckSchema], default: [] },
    tna: {
      yarnDate: text,
      knitStart: text,
      knitEnd: text,
      dyeStart: text,
      dyeEnd: text,
      deliStart: text,
      deliEnd: text,
    },
    checklistVersion: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    updatedBy: text,
  },
  { timestamps: true, minimize: false, versionKey: false, collection: 'orderplanguides' }
);

export const OrderPlanGuide: Model<IOrderPlanGuide> = mongoose.model<IOrderPlanGuide>('OrderPlanGuide', orderPlanGuideSchema);
