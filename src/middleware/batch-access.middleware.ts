import { Request, Response, NextFunction } from 'express';
import { hasBatchAccess } from '../utils/batch-rules.js';

/** Any Batch Plan, Batch Card, Batch Report or Batch Setup menu permission (Admin always). */
export function requireBatchAccess(req: Request, res: Response, next: NextFunction): void {
  if (hasBatchAccess(req.user)) {
    next();
    return;
  }
  res.status(403).json({ message: 'Access forbidden: Batch Plan permission required.' });
}
