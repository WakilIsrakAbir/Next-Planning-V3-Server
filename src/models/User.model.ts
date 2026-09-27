import mongoose, { Document, Model, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUserPermissions {
  menus?: {
    dashboard?: boolean;
    dataManagement?: {
      upload?: boolean;
      setup?: boolean;
    };
    orderPlanning?: {
      yd?: boolean;
      knitting?: boolean;
      dyeing?: boolean;
      finishing?: boolean;
      delivery?: boolean;
    };
    reports?: {
      yd?: boolean;
      knitting?: boolean;
      dyeing?: boolean;
      finishing?: boolean;
      delivery?: boolean;
      orderStatus?: boolean;
      productInfo?: boolean;
      planningProdInfo?: boolean;
    };
    tracking?: {
      yd?: boolean;
      knitting?: boolean;
      dyeing?: boolean;
      finishing?: boolean;
      delivery?: boolean;
      deliveryFloor?: boolean;
    };
    loadCalculation?: {
      detailed?: boolean;
      summary?: boolean;
    };
  };
  actions?: {
    uploadGeneral?: boolean;
    uploadDept?: boolean;
    saveYD?: boolean;
    saveKnitting?: boolean;
    saveDyeing?: boolean;
    saveFinishing?: boolean;
    saveDelivery?: boolean;
    saveActualYD?: boolean;
    saveActualKnitting?: boolean;
    saveActualDyeing?: boolean;
    saveActualFinishing?: boolean;
    saveActualDelivery?: boolean;
    saveActualDeliveryFloor?: boolean;
    exportExcel?: boolean;
    exportPdf?: boolean;
  };
  buyers?: {
    accessType: 'all' | 'selected' | 'none';
    buyerIds?: string[];
  };
}

export interface IUser extends Document {
  username: string;
  password?: string;
  role: 'Admin' | 'Approver' | 'Planner' | 'Viewer';
  status: 'active' | 'inactive';
  permissions: IUserPermissions;
  lastActive: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ['Admin', 'Approver', 'Planner', 'Viewer'],
      default: 'Viewer',
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    permissions: {
      type: Schema.Types.Mixed,
      default: {},
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Hash password before saving if modified
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
