import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IDeptValidOrders extends Document {
  dept: string;
  validOrderNos: string[];
  updatedAt: Date;
}

const deptValidOrdersSchema = new Schema<IDeptValidOrders>({
  dept: { type: String, required: true, unique: true, index: true },
  validOrderNos: { type: [String], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

export const DeptValidOrders: Model<IDeptValidOrders> = mongoose.model<IDeptValidOrders>(
  'DeptValidOrders',
  deptValidOrdersSchema
);
