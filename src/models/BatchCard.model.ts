import mongoose, { Document, Model, Schema } from 'mongoose';

// Batch Plan module: one generated Batch Process Card (snapshot, versions and history inside `cardJson`).
// Same collection and fields as the old backend (models/BatchCard.js).
export interface IBatchCard extends Document {
  cardId: string;
  orderKey: string;
  cardJson: string;
  updatedBy: string;
  retainedUnit?: string;
  createdAt: Date;
  updatedAt: Date;
}

const batchCardSchema = new Schema<IBatchCard>(
  {
    cardId: { type: String, required: true, unique: true, index: true },
    orderKey: { type: String, default: '', index: true },
    // Card record as JSON text.
    cardJson: { type: String, default: '{}' },
    updatedBy: { type: String, default: '' },
    // Unit this card keeps in the sidebar, '' for none (lib/batch/source.ts cardRetainedUnit).
    retainedUnit: { type: String },
  },
  { timestamps: true, minimize: false }
);

export const BatchCard: Model<IBatchCard> = mongoose.model<IBatchCard>('BatchCard', batchCardSchema);
