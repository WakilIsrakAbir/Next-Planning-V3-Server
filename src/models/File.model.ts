import mongoose, { Document, Model, Schema } from 'mongoose';

// 'BP' = Batch Plan module BP Data (stored in BatchBpData, never in Order).
export type FileCategory = 'General' | 'Knitting' | 'Dyeing' | 'Finishing' | 'Delivery' | 'YD' | 'BP';

export interface IFile extends Document {
  originalName: string;
  savedName: string;
  uploadedBy: string;
  role: string;
  category: FileCategory;
  size: number;
  // Result of reading the file at upload time: 'ok', or 'failed' with parseError.
  parseStatus?: 'ok' | 'failed';
  parseError?: string;
  orderCount?: number;
  // The stored copy (GridFS) was removed; the record is the upload history and is never deleted.
  // Shared with the old app (Shimul Mama Project V2), which writes the same fields.
  blobDeleted?: boolean;
  blobDeletedAt?: Date | null;
  blobBackupPath?: string;
  blobNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<IFile>(
  {
    originalName: { type: String, required: true },
    savedName: { type: String, required: true },
    uploadedBy: { type: String, required: true },
    role: { type: String, required: true },
    category: {
      type: String,
      enum: ['General', 'Knitting', 'Dyeing', 'Finishing', 'Delivery', 'YD', 'BP'],
      default: 'General',
    },
    size: { type: Number },
    parseStatus: { type: String, enum: ['ok', 'failed'] },
    parseError: { type: String },
    orderCount: { type: Number },
    blobDeleted: { type: Boolean },
    blobDeletedAt: { type: Date },
    blobBackupPath: { type: String },
    blobNote: { type: String },
  },
  { timestamps: true }
);

export const File: Model<IFile> = mongoose.model<IFile>('File', fileSchema);
