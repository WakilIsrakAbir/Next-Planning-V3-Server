import { Request, Response } from 'express';
import fs from 'fs';
import mongoose from 'mongoose';
import { File, FileCategory } from '../models/File.model.js';
import { Order } from '../models/Order.model.js';
import { OrderDate } from '../models/OrderDate.model.js';
import { DeptValidOrders } from '../models/DeptValidOrders.model.js';
import { getGridFSBucket } from '../config/gridfs.js';
import { ExcelParserService } from '../services/excel-parser.service.js';

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
        await ExcelParserService.parseAndStoreExcel(savedName, category || 'General', bucket);
        console.log(`✅ Excel parsed and synced: ${savedName}`);
      } catch (parseErr: any) {
        console.warn('Excel parse warning:', parseErr.message);
      }

      res.status(200).json({
        message: 'File uploaded and synchronized successfully!',
        file: newFile,
      });
    } catch (err: any) {
      console.error('Upload Error:', err);
      res.status(500).json({ message: err.message || 'Server error during file upload.' });
    }
  }

  static async getAllFiles(req: Request, res: Response): Promise<void> {
    try {
      const files = await File.find().sort({ createdAt: -1 }).lean();
      res.status(200).json(files);
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

  static async deleteFile(req: Request, res: Response): Promise<void> {
    try {
      const fileId = String(req.params.id);
      const fileRecord = await File.findById(fileId);

      if (!fileRecord) {
        res.status(404).json({ message: 'File record not found.' });
        return;
      }

      const bucket = getGridFSBucket();
      try {
        const gridFSFiles = await mongoose.connection.db!
          .collection('uploads.files')
          .find({ filename: fileRecord.savedName })
          .toArray();

        for (const f of gridFSFiles) {
          await bucket.delete(f._id);
        }
      } catch (gridErr: any) {
        console.warn('GridFS delete warning:', gridErr.message);
      }

      await File.findByIdAndDelete(fileId);
      res.status(200).json({ message: 'File deleted successfully.' });
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to delete file.' });
    }
  }

  static async clearAllPlanning(req: Request, res: Response): Promise<void> {
    try {
      await OrderDate.deleteMany({});
      await DeptValidOrders.deleteMany({});
      await Order.updateMany(
        {},
        {
          $set: {
            knittingPlanStatus: 'Pending',
            dyeingPlanStatus: 'Pending',
            finishingPlanStatus: 'Pending',
            deliveryPlanStatus: 'Pending',
            ydPlanStatus: 'Pending',
            knittingActualEnd: '',
            dyeingActualEnd: '',
            finishingActualEnd: '',
            deliveryActualEnd: '',
            ydActualEnd: '',
          },
        }
      );
      res.status(200).json({ message: 'All saved planning records cleared successfully.' });
    } catch (err: any) {
      res.status(500).json({ message: 'Failed to clear planning data.' });
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
          await ExcelParserService.parseAndStoreExcel(file.savedName, file.category || 'General', bucket);
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
