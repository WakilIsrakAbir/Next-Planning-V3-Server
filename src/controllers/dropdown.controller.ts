import { Request, Response } from 'express';
import { DropdownService } from '../services/dropdown.service.js';
import { DropdownType, DropdownStatus } from '../models/DropdownMaster.model.js';

export class DropdownController {
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const data = await DropdownService.getAllDropdowns();
      res.status(200).json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Failed to fetch dropdown options.' });
    }
  }

  static async addItem(req: Request, res: Response): Promise<void> {
    try {
      const { type, name } = req.body;
      const result = await DropdownService.addDropdownItem(type as DropdownType, name);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message || 'Failed to add dropdown item.' });
    }
  }

  static async updateItem(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const { name, status } = req.body;
      const updated = await DropdownService.updateDropdownItem(id, {
        name,
        status: status as DropdownStatus,
      });
      res.status(200).json({
        message: `"${updated.name}" updated successfully!`,
        item: updated,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || 'Failed to update dropdown item.' });
    }
  }

  static async deleteItem(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const result = await DropdownService.deleteDropdownItem(id);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message || 'Failed to delete dropdown item.' });
    }
  }
}
