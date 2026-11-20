import mongoose, { Model, Schema } from 'mongoose';

/** One criterion of the Plan Check List (Data Management > Plan Check List). */
export interface IPlanCheckItem {
  /** Fixed id: a rename keeps the order guides that set this criterion to Yes linked to it. */
  id: string;
  name: string;
  /** Days added to the T&A Knitting Start when the criterion is Yes on an order. */
  startDays: number;
  /** Days added to the T&A Knitting End when the criterion is Yes on an order. */
  endDays: number;
  /** Inactive criteria are not offered on order pages and never count towards the lead time. */
  active: boolean;
}

/**
 * V3-only planning settings (V2 never reads this collection), one document per setting with a fixed string _id.
 * The fixed _id keeps each setting unique without a unique index, which matters because autoIndex is off on Vercel.
 *
 * - `_id: 'planCheckList'`: `value` is the IPlanCheckItem list in display order.
 *
 * `version` goes up by one on every save (optimistic locking, as in BatchSetting); `__v` is not used.
 */
export interface IPlanningSetting {
  _id: string;
  value: any;
  version: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const planningSettingSchema = new Schema<IPlanningSetting>(
  {
    _id: { type: String, required: true },
    value: { type: Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 0 },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true, minimize: false, versionKey: false, collection: 'planningsettings' }
);

export const PlanningSetting: Model<IPlanningSetting> = mongoose.model<IPlanningSetting>(
  'PlanningSetting',
  planningSettingSchema
);
