import { DropdownMaster, IDropdownMaster, DropdownType, DropdownStatus } from '../models/DropdownMaster.model.js';
import { OrderDate } from '../models/OrderDate.model.js';

export const DEFAULT_UNITS = ['EFL', 'EKL', 'Ext', 'Outside'];
export const DEFAULT_PROCESSES = ['Solid', 'Dyeing Wash', 'HTR', 'Pluvia', 'SB', 'WH', 'DF'];

export class DropdownService {
  /**
   * Seeds default Unit and Process items if collection is empty
   */
  static async ensureSeedData(): Promise<void> {
    const count = await DropdownMaster.countDocuments();
    if (count === 0) {
      const seedItems: Array<{ type: DropdownType; name: string; status: DropdownStatus }> = [];

      DEFAULT_UNITS.forEach((name) => {
        seedItems.push({ type: 'UNIT', name, status: 'ACTIVE' });
      });

      DEFAULT_PROCESSES.forEach((name) => {
        seedItems.push({ type: 'PROCESS', name, status: 'ACTIVE' });
      });

      await DropdownMaster.insertMany(seedItems);
      console.log('✅ DropdownMaster initial seed data inserted.');
    }
  }

  static async getAllDropdowns(): Promise<{
    units: IDropdownMaster[];
    processes: IDropdownMaster[];
    totalUnits: number;
    totalProcesses: number;
  }> {
    await this.ensureSeedData();

    const items = await DropdownMaster.find().sort({ createdAt: 1 }).lean();
    const units = items.filter((it) => it.type === 'UNIT');
    const processes = items.filter((it) => it.type === 'PROCESS');

    return {
      units: units as unknown as IDropdownMaster[],
      processes: processes as unknown as IDropdownMaster[],
      totalUnits: units.length,
      totalProcesses: processes.length,
    };
  }

  static async addDropdownItem(type: DropdownType, name: string): Promise<{ item: IDropdownMaster; message: string }> {
    const trimmedType = type.toUpperCase() as DropdownType;
    if (!['UNIT', 'PROCESS'].includes(trimmedType)) {
      throw new Error('Invalid type. Must be UNIT or PROCESS.');
    }

    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      throw new Error('Item name cannot be empty.');
    }

    // Case-insensitive duplicate check
    const existing = await DropdownMaster.findOne({
      type: trimmedType,
      name: { $regex: `^${trimmedName}$`, $options: 'i' },
    });

    if (existing) {
      if (existing.status === 'HIDDEN') {
        existing.status = 'ACTIVE';
        existing.deletedAt = null;
        await existing.save();
        return {
          item: existing,
          message: `"${trimmedName}" previously existed as Hidden and is now reactivated!`,
        };
      }
      throw new Error(`"${trimmedName}" already exists in ${trimmedType.toLowerCase()} list!`);
    }

    const newItem = new DropdownMaster({
      type: trimmedType,
      name: trimmedName,
      status: 'ACTIVE',
    });

    await newItem.save();
    return {
      item: newItem,
      message: `"${trimmedName}" added successfully!`,
    };
  }

  static async updateDropdownItem(
    id: string,
    data: { name?: string; status?: DropdownStatus }
  ): Promise<IDropdownMaster> {
    const item = await DropdownMaster.findById(id);
    if (!item) {
      throw new Error('Dropdown item not found.');
    }

    if (data.name && data.name.trim()) {
      const newName = data.name.trim();
      const duplicate = await DropdownMaster.findOne({
        _id: { $ne: id },
        type: item.type,
        name: { $regex: `^${newName}$`, $options: 'i' },
      });

      if (duplicate) {
        throw new Error(`"${newName}" already exists in ${item.type.toLowerCase()} list!`);
      }
      item.name = newName;
    }

    if (data.status && ['ACTIVE', 'HIDDEN'].includes(data.status)) {
      item.status = data.status;
      if (data.status === 'ACTIVE') {
        item.deletedAt = null;
      }
    }

    await item.save();
    return item;
  }

  /**
   * Delete safety check: If option is referenced in historical orders, mark HIDDEN instead of deleting
   */
  static async deleteDropdownItem(id: string): Promise<{
    action: 'deleted' | 'hidden';
    message: string;
    item?: IDropdownMaster;
  }> {
    const item = await DropdownMaster.findById(id);
    if (!item) {
      throw new Error('Dropdown item not found.');
    }

    let isUsed = false;
    if (item.type === 'UNIT') {
      const usedRecord = await OrderDate.findOne({
        'dyeing.itemData.Unit': item.name,
      }).lean();
      if (usedRecord) isUsed = true;
    } else if (item.type === 'PROCESS') {
      const usedRecord = await OrderDate.findOne({
        $or: [
          { 'dyeing.itemData.ProcessName': item.name },
          { 'dyeing.itemData.Process Name': item.name },
        ],
      }).lean();
      if (usedRecord) isUsed = true;
    }

    if (isUsed) {
      item.status = 'HIDDEN';
      item.deletedAt = new Date();
      await item.save();

      return {
        action: 'hidden',
        message: `⚠️ "${item.name}" is used in historical order records. It was marked as Hidden to protect data integrity.`,
        item,
      };
    }

    await DropdownMaster.findByIdAndDelete(id);
    return {
      action: 'deleted',
      message: `"${item.name}" has been permanently deleted.`,
    };
  }
}
