import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB(): Promise<typeof mongoose> {
  try {
    const conn = await mongoose.connect(env.MONGO_URI);
    console.log(`✅ MongoDB Connected Successfully: ${conn.connection.host}`);
    return conn;
  } catch (err: any) {
    console.error(`❌ MongoDB Connection Error: ${err.message}`);
    throw err;
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB connection lost. Attempting reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB Reconnected successfully.');
});
