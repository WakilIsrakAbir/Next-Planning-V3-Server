import { Request, Response, NextFunction } from 'express';

export function requireRole(...allowedRoles: Array<'Admin' | 'Approver' | 'Planner' | 'Viewer'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required.' });
      return;
    }

    if (allowedRoles.includes(req.user.role)) {
      next();
      return;
    }

    res.status(403).json({
      message: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}.`,
    });
  };
}

export const requireAdmin = requireRole('Admin');

export function requireSetupPermission(req: Request, res: Response, next: NextFunction): void {
  if (req.user && (req.user.role === 'Admin' || req.user.permissions?.menus?.dataManagement?.setup)) {
    next();
    return;
  }
  res.status(403).json({ message: 'Access forbidden: Setup privileges required.' });
}
