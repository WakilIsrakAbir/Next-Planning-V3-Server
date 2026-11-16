import mongoose from 'mongoose';
import { File, IFile } from '../models/File.model.js';
import { getGridFSBucket } from '../config/gridfs.js';

/*
 * Stored copies of uploaded Excel files (GridFS bucket "uploads").
 *
 * The app reads each file once, when it is uploaded; the stored copy is only a fallback. To keep the database
 * small, each category keeps the copies of its newest KEEP_COPIES successful uploads. Older copies are removed
 * after the next successful upload. The upload history (the File record) is never deleted: a removed copy is
 * only marked blobDeleted. Nothing outside uploads.files / uploads.chunks is ever deleted here.
 *
 * The old app (Shimul Mama Project V2) shares this database and applies the same rule and the same marks.
 */

export const KEEP_COPIES = 3;

type FileRecord = Pick<IFile, 'category' | 'savedName' | 'createdAt'> & {
  _id: mongoose.Types.ObjectId | string;
  parseStatus?: string;
  blobDeleted?: boolean;
};

// Records of one category (records saved before categories existed count as General).
function categoryFilter(category: string | undefined): Record<string, any> {
  const cat = category || 'General';
  if (cat === 'General') return { $or: [{ category: 'General' }, { category: { $exists: false } }, { category: null }] };
  return { category: cat };
}

export class FileRetentionService {
  /** Removes the stored copy of one upload and marks its record; the record itself stays. */
  static async removeCopy(rec: FileRecord, note: string): Promise<void> {
    const bucket = getGridFSBucket();
    const copies = await mongoose.connection.db!.collection('uploads.files').find({ filename: rec.savedName }).toArray();
    for (const c of copies) await bucket.delete(c._id);
    await File.updateOne({ _id: rec._id }, { $set: { blobDeleted: true, blobDeletedAt: new Date(), blobNote: note } });
  }

  /**
   * After a successful upload: keeps the copies of the category's newest KEEP_COPIES successful uploads
   * and removes the other copies of that category. Returns how many copies were removed.
   */
  static async keepLatestCopies(category: string | undefined): Promise<number> {
    const records = (await File.find({ ...categoryFilter(category), blobDeleted: { $ne: true } })
      .sort({ createdAt: -1, _id: -1 })
      .lean()) as unknown as FileRecord[];
    const keep = new Set<string>();
    for (const r of records) {
      if (keep.size >= KEEP_COPIES) break;
      if (r.parseStatus !== 'failed') keep.add(String(r._id));
    }
    let removed = 0;
    for (const r of records) {
      if (keep.has(String(r._id))) continue;
      await this.removeCopy(r, `retention: the newest ${KEEP_COPIES} copies of ${category || 'General'} are kept`);
      removed++;
    }
    return removed;
  }

  /** The upload in use: the newest successful upload of its category that still has its copy. */
  static async isInUse(rec: FileRecord): Promise<boolean> {
    if (rec.blobDeleted || rec.parseStatus === 'failed') return false;
    const newest = await File.findOne({ ...categoryFilter(rec.category), blobDeleted: { $ne: true }, parseStatus: { $ne: 'failed' } })
      .sort({ createdAt: -1, _id: -1 })
      .select({ _id: 1 })
      .lean();
    return !!newest && String(newest._id) === String(rec._id);
  }
}
