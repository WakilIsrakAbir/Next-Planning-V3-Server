import { IUserPermissions } from '../models/User.model.js';

export interface IAuthUser {
  userId: string;
  username: string;
  role: 'Admin' | 'Approver' | 'Planner' | 'Viewer';
  permissions?: IUserPermissions;
}

declare global {
  namespace Express {
    interface Request {
      user?: IAuthUser;
      allowedRawBuyers?: string[];
    }
  }
}
