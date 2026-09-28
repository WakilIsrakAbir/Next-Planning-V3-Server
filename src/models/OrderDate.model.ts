import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IOrderDate extends Document {
  orderNo: string;
  knitting: any[];
  dyeing: any[];
  finishing: any[];
  delivery: any[];
  yd: any[];

  knittingStatus: string;
  dyeingStatus: string;
  finishingStatus: string;
  deliveryStatus: string;
  ydStatus: string;

  knittingCompletedDate: string | null;
  dyeingCompletedDate: string | null;
  finishingCompletedDate: string | null;
  deliveryCompletedDate: string | null;
  ydCompletedDate: string | null;

  knittingActual?: Record<string, any>;
  dyeingActual?: Record<string, any>;
  finishingActual?: Record<string, any>;
  deliveryActual?: Record<string, any>;
  ydActual?: Record<string, any>;
  deliveryfloorActual?: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

const orderDateSchema = new Schema<IOrderDate>(
  {
    orderNo: { type: String, required: true, unique: true, index: true },
    knitting: { type: Schema.Types.Mixed, default: [] },
    dyeing: { type: Schema.Types.Mixed, default: [] },
    finishing: { type: Schema.Types.Mixed, default: [] },
    delivery: { type: Schema.Types.Mixed, default: [] },
    yd: { type: Schema.Types.Mixed, default: [] },

    knittingStatus: { type: String, default: 'On Process' },
    dyeingStatus: { type: String, default: 'On Process' },
    finishingStatus: { type: String, default: 'On Process' },
    deliveryStatus: { type: String, default: 'On Process' },
    ydStatus: { type: String, default: 'On Process' },

    knittingCompletedDate: { type: String, default: null },
    dyeingCompletedDate: { type: String, default: null },
    finishingCompletedDate: { type: String, default: null },
    deliveryCompletedDate: { type: String, default: null },
    ydCompletedDate: { type: String, default: null },

    knittingActual: { type: Schema.Types.Mixed, default: null },
    dyeingActual: { type: Schema.Types.Mixed, default: null },
    finishingActual: { type: Schema.Types.Mixed, default: null },
    deliveryActual: { type: Schema.Types.Mixed, default: null },
    ydActual: { type: Schema.Types.Mixed, default: null },
    deliveryfloorActual: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, strict: false }
);

// Indexes for high-speed tracking and orphaned status queries
orderDateSchema.index({ orderNo: 1, knittingStatus: 1 });
orderDateSchema.index({ orderNo: 1, dyeingStatus: 1 });
orderDateSchema.index({ orderNo: 1, deliveryStatus: 1 });
orderDateSchema.index({ orderNo: 1, ydStatus: 1 });
orderDateSchema.index({ 'knittingActual.actualEnd': 1 });
orderDateSchema.index({ 'dyeingActual.actualEnd': 1 });
orderDateSchema.index({ 'deliveryActual.actualEnd': 1 });
orderDateSchema.index({ 'ydActual.actualEnd': 1 });

export const OrderDate: Model<IOrderDate> = mongoose.model<IOrderDate>('OrderDate', orderDateSchema);
