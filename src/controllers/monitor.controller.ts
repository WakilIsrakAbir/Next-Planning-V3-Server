import { Request, Response } from 'express';
import { DatabaseNotReadyError, MonitorService } from '../services/monitor.service.js';

export class MonitorController {
  /** GET /api/monitor/stats - Admin, or menus.dataManagement.atlasMonitor */
  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const data = await MonitorService.stats(req.user);
      res.set('Cache-Control', 'no-store');
      res.status(200).json(data);
    } catch (err: any) {
      if (err instanceof DatabaseNotReadyError) {
        res.status(503).json({ message: err.message });
        return;
      }
      console.error('Monitor stats error:', err);
      res.status(500).json({ message: 'Could not load database stats.' });
    }
  }

  /** GET /api/monitor/backup?files=1|0 - Admin only (the file holds the users' password hashes) */
  static async downloadBackup(req: Request, res: Response): Promise<void> {
    try {
      await MonitorService.streamBackup(res, req.query.files !== '0', req.user?.username || '');
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(err instanceof DatabaseNotReadyError ? 503 : 500).json({ message: err.message || 'Backup failed.' });
      }
    }
  }
}
