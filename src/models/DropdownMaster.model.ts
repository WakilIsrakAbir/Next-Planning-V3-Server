import mongoose, { Document, Model, Schema } from 'mongoose';

export type DropdownType = 'UNIT' | 'PROCESS';
export type DropdownStatus = 'ACTIVE' | 'HIDDEN';

export interface IDropdownMaster extends Document {
  type: DropdownType;
  name: string;
  status: DropdownStatus;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const dropdownMasterSchema = new Schema<IDropdownMaster>(
  {
    type: {
      type: String,
      required: true,
      enum: ['UNIT', 'PROCESS'],
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'HIDDEN'],
      default: 'ACTIVE',
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index to guarantee uniqueness per dropdown type
dropdownMasterSchema.index({ type: 1, name: 1 }, { unique: true });

export const DropdownMaster: Model<IDropdownMaster> = mongoose.model<IDropdownMaster>(
  'DropdownMaster',
  dropdownMasterSchema
);
