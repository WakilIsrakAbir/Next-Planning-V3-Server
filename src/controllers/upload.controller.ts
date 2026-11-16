import { Request, Response } from 'express';
import fs from 'fs';
import mongoose from 'mongoose';
import { File, FileCategory } from '../models/File.model.js';
import { can } from '../utils/batch-rules.js';
import { getGridFSBucket } from '../config/gridfs.js';
import { ExcelParserService } from '../services/excel-parser.service.js';
import { OrderService } from '../services/order.service.js';
import { FileRetentionService, KEEP_COPIES } from '../services/file-retention.service.js';

function removeTempFile(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_) {
    /* already removed */
  }
}

export class UploadController {
  static async uploadFile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ message: 'No file uploaded.' });
        return;
      }

      const { uploadedBy, role, category } = req.body;
      const originalName = req.file.originalname;
      const savedName = req.file.filename;

      const bucket = getGridFSBucket();

      // Batch Plan module: BP Data is checked before anything is saved.
      if (category === 'BP') {
        // Same permission the page uses to show the BP Data tab (Admin always allowed).
        if (!can(req.user, 'actions.uploadBP')) {
          removeTempFile(req.file.path);
          res.status(403).json({ message: 'You do not have permission to upload BP Data.' });
          return;
        }
        const bpError = ExcelParserService.bpFileError(req.file.path);
        if (bpError) {
          removeTempFile(req.file.path);
          res.status(400).json({ message: bpError });
          return;
        }
      }

      // A General or department file without a single order number would change nothing: it is not stored.
      let orderCount: number | undefined;
      if (category !== 'BP') {
        try {
          orderCount = ExcelParserService.orderRowCount(req.file.path);
        } catch (readErr: any) {
          removeTempFile(req.file.path);
          res.status(400).json({ message: 'Sheet parsing error: ' + readErr.message + '. Nothing was saved.' });
          return;
        }
        if (!orderCount) {
          removeTempFile(req.file.path);
          res.status(400).json({
            message: 'No order numbers were found on the first sheet (OrderNo / BookingNo column). Nothing was saved.',
          });
          return;
        }
      }

      const uploadStream = bucket.openUploadStream(savedName, {
        contentType: req.file.mimetype,
        metadata: {
          originalName,
          uploadedBy: uploadedBy || req.user?.username || 'Unknown',
          category: category || 'General',
        },
      });

      const readStream = fs.createReadStream(req.file.path);

      await new Promise<void>((resolve, reject) => {
        readStream.pipe(uploadStream).on('finish', () => resolve()).on('error', reject);
      });

      // Remove temporary disk file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      const newFile = new File({
        originalName,
        savedName,
        uploadedBy: uploadedBy || req.user?.username || 'Unknown',
        role: role || req.user?.role || 'Planner',
        category: (category as FileCategory) || 'General',
        size: req.file.size,
      });

      await newFile.save();

      // Parse spreadsheet and store in Order collection
      try {
        await ExcelParserService.parseAndStoreExcel(savedName, category || 'General', bucket, originalName);
        console.log(`✅ Excel parsed and synced: ${savedName}`);
        OrderService.clearReportCache();
      } catch (parseErr: any) {
        // The upload is kept in the history as failed: it is never "in use" and nothing is removed for it.
        console.warn('Excel parse error:', parseErr.message);
        await File.updateOne({ _id: newFile._id }, { $set: { parseStatus: 'failed', parseError: String(parseErr.message || parseErr) } });
        res.status(422).json({
          message: `The file was saved but could not be read: ${parseErr.message}. Please check the file and upload it again.`,
        });
        return;
      }
      await File.updateOne({ _id: newFile._id }, { $set: { parseStatus: 'ok', ...(orderCount !== undefined ? { orderCount } : {}) } });

      // Keep only the newest copies of this category (the upload history itself is never deleted).
      let copiesRemoved = 0;
      try {
        copiesRemoved = await FileRetentionService.keepLatestCopies(category || 'General');
      } catch (retentionErr: any) {
        console.warn('Old file copies were not removed:', retentionErr.message);
      }

      res.status(200).json({
        message: 'File uploaded and synchronized successfully!',
        file: newFile,
        copiesRemoved,
      });
    } catch (err: any) {
      console.error('Upload Error:', err);
      removeTempFile(req.file?.path);
      res.status(500).json({ message: err.message || 'Server error during file upload.' });
    }
  }

  /**
   * GET /api/files/all - every upload record (the whole history), newest first.
   * GET /api/files/all?scope=recent - only uploads whose stored copy is kept (the newest of each category),
   * each marked inUse when it is its category's newest successful upload, plus the history counts.
   */
  static async getAllFiles(req: Request, res: Response): Promise<void> {
    try {
      if (req.query.scope !== 'recent') {
        const files = await File.find().sort({ createdAt: -1 }).lean();
        res.status(200).json(files);
        return;
      }
      const files = await File.find({ blobDeleted: { $ne: true } }).sort({ createdAt: -1, _id: -1 }).lean();
      const seen = new Set<string>();
      const inUse = new Set<string>();
      for (const f of files) {
        const cat = f.category || 'General';
        if (f.parseStatus !== 'failed' && !seen.has(cat)) {
          seen.add(cat);
          inUse.add(String(f._id));
        }
      }
      const history = await File.aggregate([
        {
          $group: {
            _id: { $ifNull: ['$category', 'General'] },
            uploads: { $sum: 1 },
            withoutCopy: { $sum: { $cond: [{ $eq: ['$blobDeleted', true] }, 1, 0] } },
          },
        },
      ]);
      res.status(200).json({
        keepPerCategory: KEEP_COPIES,
        files: files.map((f) => ({ ...f, inUse: inUse.has(String(f._id)) })),
        history: Object.fromEntries(history.map((h: any) => [h._id, { uploads: h.uploads, withoutCopy: h.withoutCopy }])),
      });
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to retrieve files.' });
    }
  }

  static async downloadFile(req: Request, res: Response): Promise<void> {
    try {
      const filename = String(req.params.filename);
      const bucket = getGridFSBucket();

      const files = await mongoose.connection.db!
        .collection('uploads.files')
        .find({ filename })
        .toArray();

      if (!files || files.length === 0) {
        res.status(404).json({ message: 'File not found in GridFS.' });
        return;
      }

      const file = files[0];
      res.set('Content-Type', file.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Cache-Control', 'public, max-age=31536000, immutable');

      const downloadStream = bucket.openDownloadStreamByName(filename);
      downloadStream.on('error', (err) => {
        console.error('GridFS stream error:', err);
        if (!res.headersSent) {
          res.status(404).json({ message: 'Failed to read file from GridFS.' });
        }
      });

      downloadStream.pipe(res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error serving file.' });
      }
    }
  }

  /**
   * DELETE /api/files/:id - removes the stored copy of one upload (Admin or actions.deleteFiles).
   * The upload record stays as history and no planning data is touched. The upload in use (its category's
   * newest successful upload) cannot be removed.
   */
  static async deleteFile(req: Request, res: Response): Promise<void> {
    try {
      if (!can(req.user, 'actions.deleteFiles')) {
        res.status(403).json({ message: 'You do not have permission to delete uploaded files.' });
        return;
      }
      const fileId = String(req.params.id);
      if (!mongoose.isValidObjectId(fileId)) {
        res.status(404).json({ message: 'File record not found.' });
        return;
      }
      const fileRecord = await File.findById(fileId).lean();
      if (!fileRecord) {
        res.status(404).json({ message: 'File record not found.' });
        return;
      }
      if (fileRecord.blobDeleted) {
        res.status(200).json({ message: 'The stored copy was already removed. The upload history is kept.' });
        return;
      }
      if (await FileRetentionService.isInUse(fileRecord as any)) {
        res.status(409).json({
          message: `This is the ${fileRecord.category || 'General'} file in use (the latest upload), so it is kept. Upload a newer file first.`,
        });
        return;
      }
      await FileRetentionService.removeCopy(fileRecord as any, `removed by ${req.user?.username || 'unknown'}`);
      res.status(200).json({ message: 'The stored copy was removed. The upload history and all planning data stay.' });
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to delete file.' });
    }
  }

  static async migrateToOrders(req: Request, res: Response): Promise<void> {
    try {
      const bucket = getGridFSBucket();
      const allFiles = await File.find().sort({ createdAt: 1 }).lean();

      const latestMap = new Map<string, any>();
      allFiles.forEach((f) => {
        const key = `${f.originalName}__${f.category || 'General'}`;
        latestMap.set(key, f);
      });
      const latestFiles = Array.from(latestMap.values());

      let processed = 0;
      for (const file of latestFiles) {
        try {
          await ExcelParserService.parseAndStoreExcel(
            file.savedName,
            file.category || 'General',
            bucket,
            file.originalName
          );
          processed++;
          console.log(`Migrated: ${file.originalName} (${file.category})`);
        } catch (e: any) {
          console.error(`Failed to migrate ${file.originalName}:`, e.message);
        }
      }

      res.status(200).json({ message: `Migration complete. ${processed} files processed.` });
    } catch (err: any) {
      console.error('Migration error:', err);
      res.status(500).json({ message: 'Migration failed: ' + err.message });
    }
  }
}
