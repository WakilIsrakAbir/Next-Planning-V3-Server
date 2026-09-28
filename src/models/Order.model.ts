import mongoose, { Document, Model, Schema } from 'mongoose';

export type PlanStatus = 'Pending' | 'Confirm' | 'Tentative' | 'Completed';

export interface IOrder extends Document {
  orderNo: string;
  buyer: string;
  bookingDate: string;
  requiredQtyKgs: any;
  bookingBy: string;
  pmc: string;
  finalConfirmation: string;
  eventDay: any;
  ship1: string;
  shipLast: string;
  yarnDate: string;
  knitStart: string;
  knitEnd: string;
  dyeStart: string;
  dyeEnd: string;
  deliStart: string;
  deliEnd: string;
  fabricNotes: string;
  status: string;

  // Additional General Info Fields
  gmtUnit: string;
  floor: string;
  buyerTeam: string;
  bookedBy: string;
  style: string;
  bpStatus: string;
  ald: string;
  brush: string;
  peach: string;
  heatset: string;
  bodyFabric: string;
  programType: string;
  bodyGsm: any;
  pmcNotes: string;

  // Department Item Arrays (From Department Excel Uploads)
  knittingItems: any[];
  dyeingItems: any[];
  finishingItems: any[];
  deliveryItems: any[];
  ydItems: any[];

  // Department Plan Statuses
  knittingPlanStatus: PlanStatus;
  dyeingPlanStatus: PlanStatus;
  finishingPlanStatus: PlanStatus;
  deliveryPlanStatus: PlanStatus;
  ydPlanStatus: PlanStatus;

  // Actual End dates cached for fast tracking queries
  knittingActualEnd?: string;
  dyeingActualEnd?: string;
  finishingActualEnd?: string;
  deliveryActualEnd?: string;
  ydActualEnd?: string;

  createdAt: Date;
  updatedAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    orderNo: { type: String, required: true, unique: true, index: true },

    // General Info
    buyer: { type: String, default: '', index: true },
    bookingDate: { type: String, default: '' },
    requiredQtyKgs: { type: Schema.Types.Mixed, default: '' },
    bookingBy: { type: String, default: '' },
    pmc: { type: String, default: '' },
    finalConfirmation: { type: String, default: '' },
    eventDay: { type: Schema.Types.Mixed, default: '' },
    ship1: { type: String, default: '' },
    shipLast: { type: String, default: '' },
    yarnDate: { type: String, default: '' },
    knitStart: { type: String, default: '' },
    knitEnd: { type: String, default: '' },
    dyeStart: { type: String, default: '' },
    dyeEnd: { type: String, default: '' },
    deliStart: { type: String, default: '' },
    deliEnd: { type: String, default: '' },
    fabricNotes: { type: String, default: '' },
    status: { type: String, default: '' },

    // Additional General Info Fields
    gmtUnit: { type: String, default: '' },
    floor: { type: String, default: '' },
    buyerTeam: { type: String, default: '' },
    bookedBy: { type: String, default: '' },
    style: { type: String, default: '' },
    bpStatus: { type: String, default: '' },
    ald: { type: String, default: '' },
    brush: { type: String, default: '' },
    peach: { type: String, default: '' },
    heatset: { type: String, default: '' },
    bodyFabric: { type: String, default: '' },
    programType: { type: String, default: '' },
    bodyGsm: { type: Schema.Types.Mixed, default: '' },
    pmcNotes: { type: String, default: '' },

    // Department Items
    knittingItems: { type: Schema.Types.Mixed, default: [] },
    dyeingItems: { type: Schema.Types.Mixed, default: [] },
    finishingItems: { type: Schema.Types.Mixed, default: [] },
    deliveryItems: { type: Schema.Types.Mixed, default: [] },
    ydItems: { type: Schema.Types.Mixed, default: [] },

    // Department Plan Statuses
    knittingPlanStatus: { type: String, default: 'Pending', index: true },
    dyeingPlanStatus: { type: String, default: 'Pending', index: true },
    finishingPlanStatus: { type: String, default: 'Pending', index: true },
    deliveryPlanStatus: { type: String, default: 'Pending', index: true },
    ydPlanStatus: { type: String, default: 'Pending', index: true },

    // Cached Actual End dates
    knittingActualEnd: { type: String, default: '' },
    dyeingActualEnd: { type: String, default: '' },
    finishingActualEnd: { type: String, default: '' },
    deliveryActualEnd: { type: String, default: '' },
    ydActualEnd: { type: String, default: '' },
  },
  { timestamps: true, strict: false }
);

// Compound indexes for optimal query execution and sorting
orderSchema.index({ buyer: 1, knittingPlanStatus: 1 });
orderSchema.index({ buyer: 1, dyeingPlanStatus: 1 });
orderSchema.index({ buyer: 1, finishingPlanStatus: 1 });
orderSchema.index({ buyer: 1, deliveryPlanStatus: 1 });
orderSchema.index({ buyer: 1, ydPlanStatus: 1 });

// Sorter compound indexes: satisfying status filtering + orderNo sort without in-memory sorting
orderSchema.index({ knittingPlanStatus: 1, orderNo: -1 });
orderSchema.index({ dyeingPlanStatus: 1, orderNo: -1 });
orderSchema.index({ finishingPlanStatus: 1, orderNo: -1 });
orderSchema.index({ deliveryPlanStatus: 1, orderNo: -1 });
orderSchema.index({ ydPlanStatus: 1, orderNo: -1 });

orderSchema.index({ buyer: 1, knittingPlanStatus: 1, orderNo: -1 });
orderSchema.index({ buyer: 1, dyeingPlanStatus: 1, orderNo: -1 });
orderSchema.index({ buyer: 1, finishingPlanStatus: 1, orderNo: -1 });
orderSchema.index({ buyer: 1, deliveryPlanStatus: 1, orderNo: -1 });
orderSchema.index({ buyer: 1, ydPlanStatus: 1, orderNo: -1 });

export const Order: Model<IOrder> = mongoose.model<IOrder>('Order', orderSchema);
