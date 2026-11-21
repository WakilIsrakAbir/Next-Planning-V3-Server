import { Request, Response } from 'express';
import { PlanCheckListService } from '../services/plan-check-list.service.js';
import { HttpError } from '../utils/http-error.js';

export class PlanCheckListController {
  /**
   * GET /api/plan-check-list: any signed-in user (order pages read it). Never answers 403, because the client signs
   * the user out on a 403; whether the user may save is in `canEdit`.
   */
  static async get(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    try {
      res.status(200).json(await PlanCheckListService.get(req.user));
    } catch (err: any) {
      console.error('Plan Check List load error:', err);
      res.status(500).json({ message: 'Could not load the Plan Check List.' });
    }
  }

  /** PUT /api/plan-check-list `{items, version}`: Admin or menus.dataManagement.planCheckList. */
  static async save(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    try {
      res.status(200).json(await PlanCheckListService.save(req.user, req.body));
    } catch (err: any) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      console.error('Plan Check List save error:', err);
      res.status(500).json({ message: 'Could not save the Plan Check List.' });
    }
  }
}
