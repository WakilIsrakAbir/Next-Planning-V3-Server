import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import dropdownRoutes from './routes/dropdown.routes.js';
import orderRoutes from './routes/order.routes.js';
import batchRoutes from './routes/batch.routes.js';
import monitorRoutes from './routes/monitor.routes.js';
import planCheckListRoutes from './routes/plan-check-list.routes.js';
import { UploadController } from './controllers/upload.controller.js';
import { authenticateToken } from './middleware/auth.middleware.js';
import { apiLimiter } from './middleware/rate-limit.middleware.js';

const app = express();

/**
 * Browser origins allowed to call the API: CLIENT_URL (comma-separated list allowed), this project's own Vercel
 * deployments (production and previews of next-planning-v3-client), and localhost only outside production.
 * Matching is exact on the parsed origin, so look-alike hosts (e.g. evil-localhost.com, other *.vercel.app apps) fail.
 */
// The client's production domains (Vercel → client project → Domains). Add a new domain here when one is added there.
const PRODUCTION_CLIENT_ORIGINS = ['https://tps-epyllion.vercel.app', 'https://next-planning-v3-client.vercel.app'];
const CLIENT_ORIGINS = [
  ...PRODUCTION_CLIENT_ORIGINS,
  ...String(env.CLIENT_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
];
const PROJECT_VERCEL_ORIGIN = /^https:\/\/next-planning-v3-client(-[a-z0-9-]+)?\.vercel\.app$/;

export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const normalized = url.origin;
  if (CLIENT_ORIGINS.includes(normalized)) return true;
  if (PROJECT_VERCEL_ORIGIN.test(normalized)) return true;
  if (env.NODE_ENV !== 'production' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
  return false;
}

// Global Middlewares
// Vercel sits in front of the app: trust its proxy so rate limits see the real client IP.
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error('Blocked by CORS policy: Origin not allowed.'));
    },
    credentials: true,
    // The backup download's file name (Atlas Monitor) is read by the page from this header.
    exposedHeaders: ['Content-Disposition'],
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check Route
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'online',
    system: 'Next Planning V3 API Engine',
    timestamp: new Date().toISOString(),
  });
});

// Legacy GridFS File Serving Route
app.get('/uploads/:filename', authenticateToken, UploadController.downloadFile);

// Rate limit general API routes against scraping & denial-of-service
app.use('/api', apiLimiter);

// Connect Routes
app.use('/api/auth', authRoutes);
app.use('/api/files', uploadRoutes);
app.use('/api/dropdowns', dropdownRoutes);
app.use('/api/orders', orderRoutes);
// Batch Plan module (Batch Plan, Batch Card, Batch Report and its Setup tables)
app.use('/api/batch', batchRoutes);
// Atlas Monitor: database health and the full backup download (Data Management > Atlas Monitor)
app.use('/api/monitor', monitorRoutes);
// Plan Check List (Data Management > Plan Check List): read by every signed-in user, saved with its permission
app.use('/api/plan-check-list', planCheckListRoutes);

// Global Error Handling Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('❌ Unhandled Server Error:', err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: err.message || 'Internal Server Error',
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
});

export default app;
