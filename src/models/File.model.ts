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
  },
  { timestamps: true }
);

export const File: Model<IFile> = mongoose.model<IFile>('File', fileSchema);
