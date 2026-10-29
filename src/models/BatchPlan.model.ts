import mongoose, { Document, Model, Schema } from 'mongoose';

// Batch Plan module: saved plan state of one order (all floors), as produced by the Batch Plan page.
// `version` gives optimistic locking so two users cannot overwrite each other's save.
// Same collection and fields as the old backend (models/BatchPlan.js); both apps share this data.
export interface IBatchPlan extends Document {
  orderKey: string;
  orderNo: string;
  stateJson: string;
  version: number;
  updatedBy: string;
  retainedUnits?: string[];
  retainedVersion?: number;
  createdAt: Date;
  updatedAt: Date;
}

const batchPlanSchema = new Schema<IBatchPlan>(
  {
    orderKey: { type: String, required: true, unique: true, index: true },
    orderNo: { type: String, required: true },
    // Plan state as JSON text (keys may contain dots).
    stateJson: { type: String, default: '{}' },
    version: { type: Number, default: 0 },
    updatedBy: { type: String, default: '' },
    // Units this plan keeps in the sidebar (utils/batch-rules.ts planRetainedUnits), as of retainedVersion.
    retainedUnits: { type: [String], default: undefined },
    retainedVersion: { type: Number },
  },
  { timestamps: true, minimize: false }
);

export const BatchPlan: Model<IBatchPlan> = mongoose.model<IBatchPlan>('BatchPlan', batchPlanSchema);
