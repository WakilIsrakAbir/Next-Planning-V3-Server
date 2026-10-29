import mongoose, { Document, Model, Schema } from 'mongoose';

export type BatchSettingKey = 'setup' | 'flatAllowance' | 'unitSetup';

// Batch Plan module Setup tables: key = 'setup' (Dyeing MC), 'flatAllowance' or 'unitSetup'.
// Same collection and fields as the old backend (models/BatchSetting.js).
export interface IBatchSetting extends Document {
  key: BatchSettingKey;
  value: any;
  version: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const batchSettingSchema = new Schema<IBatchSetting>(
  {
    key: { type: String, required: true, unique: true, enum: ['setup', 'flatAllowance', 'unitSetup'] },
    value: { type: Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 0 },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true, minimize: false }
);

export const BatchSetting: Model<IBatchSetting> = mongoose.model<IBatchSetting>('BatchSetting', batchSettingSchema);
