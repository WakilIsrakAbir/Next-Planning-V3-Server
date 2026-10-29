import { Request, Response } from 'express';
import { BatchService } from '../services/batch.service.js';
import { HttpError } from '../utils/http-error.js';

// Vercel limits a buffered function response to 4.5 MB but not a streamed one; the page data grows with the
// number of orders (several MB for about a thousand orders), so it is written in parts.
const STREAM_CHUNK = 256 * 1024;

export class BatchController {
  /** GET /api/batch/units. Never answers 403 (the client logs out on a 403); without Batch access: []. */
  static async getUnits(req: Request, res: Response): Promise<void> {
    try {
      res.json({ units: await BatchService.getUnits(req.user) });
    } catch (error) {
      console.error('Batch units error:', error);
      res.status(500).json({ message: 'Could not load Batch Plan units.' });
    }
  }

  /** GET /api/batch/state: everything the Batch Plan page needs. */
  static async getState(req: Request, res: Response): Promise<void> {
    try {
      const { body, serverTiming } = await BatchService.getState(req.user);
      res.set({
        // Phase timings (DevTools > Network and the page's load summary), readable from the client's origin.
        'Server-Timing': serverTiming,
        'Access-Control-Expose-Headers': 'Server-Timing',
        'Timing-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.type('application/json');
      const bytes = Buffer.from(body, 'utf8');
      for (let offset = 0; offset < bytes.length; offset += STREAM_CHUNK) res.write(bytes.subarray(offset, offset + STREAM_CHUNK));
      res.end();
    } catch (error) {
      console.error('Batch state error:', error);
      res.status(500).json({ message: 'Could not load Batch Plan data.' });
    }
  }

  /** POST /api/batch/commit: saves changed plans, Setup tables and batch cards. */
  static async commit(req: Request, res: Response): Promise<void> {
    try {
      res.json(await BatchService.commit(req.user, req.body));
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      console.error('Batch commit error:', error);
      res.status(500).json({ message: 'Could not save Batch Plan data.' });
    }
  }
}
