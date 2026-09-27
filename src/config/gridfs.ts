import mongoose from 'mongoose';

let gfsBucket: mongoose.mongo.GridFSBucket | null = null;

export function getGridFSBucket(): mongoose.mongo.GridFSBucket {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error('Database is not connected. GridFS bucket cannot be initialized.');
  }

  if (!gfsBucket) {
    gfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads',
    });
  }

  return gfsBucket;
}

// Reset bucket on reconnection to avoid stale database handles
mongoose.connection.on('connected', () => {
  gfsBucket = null;
});

mongoose.connection.on('disconnected', () => {
  gfsBucket = null;
});
