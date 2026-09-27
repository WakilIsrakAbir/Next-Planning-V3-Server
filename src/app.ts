import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import dropdownRoutes from './routes/dropdown.routes.js';
import orderRoutes from './routes/order.routes.js';
import { UploadController } from './controllers/upload.controller.js';
import { authenticateToken } from './middleware/auth.middleware.js';

const app = express();

// Global Middlewares
app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: [env.CLIENT_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check Route
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'online',
    system: 'Epylion Next Planning V3 API Engine',
    timestamp: new Date().toISOString(),
  });
});

// Legacy GridFS File Serving Route
app.get('/uploads/:filename', authenticateToken, UploadController.downloadFile);

// Connect Routes
app.use('/api/auth', authRoutes);
app.use('/api/files', uploadRoutes);
app.use('/api/dropdowns', dropdownRoutes);
app.use('/api/orders', orderRoutes);

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
