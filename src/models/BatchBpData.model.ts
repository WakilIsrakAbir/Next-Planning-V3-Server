import mongoose, { Document, Model, Schema } from 'mongoose';

// Batch Plan module: one document per BP Data row (collar / cuff / hem / placket).
// `owner` is the lower-case upload file name; re-uploading the same file replaces its rows.
// Same collection and fields as the old backend (models/BatchBpData.js).
export interface IBatchBpData extends Document {
  orderKey: string;
  orderNo: string;
  owner: string;
  row: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const batchBpDataSchema = new Schema<IBatchBpData>(
  {
    // Normalized order number.
    orderKey: { type: String, required: true, index: true },
    orderNo: { type: String, required: true },
    owner: { type: String, default: '', index: true },
    // Original Excel row, all columns.
    row: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const BatchBpData: Model<IBatchBpData> = mongoose.model<IBatchBpData>('BatchBpData', batchBpDataSchema);
