import { Request, Response, NextFunction } from 'express';
import { Order } from '../models/Order.model.js';

let cachedRawBuyers: { buyers: string[]; timestamp: number } | null = null;
const BUYERS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function clearBuyersCache(): void {
  cachedRawBuyers = null;
}

async function getCachedRawBuyers(): Promise<string[]> {
  if (cachedRawBuyers && Date.now() - cachedRawBuyers.timestamp < BUYERS_CACHE_TTL) {
    return cachedRawBuyers.buyers;
  }
  const buyers = await Order.distinct('buyer');
  cachedRawBuyers = { buyers, timestamp: Date.now() };
  return buyers;
}

export async function buyerFilterMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // 1. Admin users have unrestricted access across all buyers
    if (req.user && req.user.role === 'Admin') {
      if (req.query.allowedBuyers) {
        if (req.query.allowedBuyers === 'NONE_ASSIGNED') {
          req.allowedRawBuyers = ['_NONE_'];
        } else {
          const ids = String(req.query.allowedBuyers).split(',').map((x) => x.trim()).filter(Boolean);
          if (ids.length > 0) {
            const rawBuyers = await getCachedRawBuyers();
            const allowedNames = rawBuyers.filter((b) => {
              const id = String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
              return ids.includes(id);
            });
            req.allowedRawBuyers = allowedNames.length > 0 ? allowedNames : ['_NONE_'];
          }
        }
      }
      return next();
    }

    // 2. Non-Admin users: STRICT server-side enforcement from req.user.permissions.buyers
    const buyerPerms = req.user?.permissions?.buyers;
    if (!buyerPerms || buyerPerms.accessType === 'all') {
      req.allowedRawBuyers = undefined; // All buyers allowed
    } else if (buyerPerms.accessType === 'none' || !buyerPerms.buyerIds || buyerPerms.buyerIds.length === 0) {
      req.allowedRawBuyers = ['_NONE_'];
    } else {
      // accessType === 'selected'
      const rawBuyers = await getCachedRawBuyers();
      const allowedNames = rawBuyers.filter((b) => {
        const id = String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
        return buyerPerms.buyerIds?.includes(id);
      });
      req.allowedRawBuyers = allowedNames.length > 0 ? allowedNames : ['_NONE_'];
    }
    next();
  } catch (err: any) {
    console.error('Error processing buyer permissions middleware:', err.message);
    req.allowedRawBuyers = ['_NONE_'];
    next();
  }
}
