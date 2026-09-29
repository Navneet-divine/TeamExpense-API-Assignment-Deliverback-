import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import expenseRoutes from './routes/expense.routes';
import receiptRoutes from './routes/receipt.routes';
import approvalRoutes from './routes/approval.routes';
import commentRoutes from './routes/comment.routes';
import reportRoutes from './routes/report.routes';

const app: Application = express();

// Disable Express fingerprint header explicitly
app.disable('x-powered-by');

// Apply baseline security headers via Helmet
app.use(helmet());

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5001'
];

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : defaultAllowedOrigins;

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, automated tests)
      if (!origin || configuredOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root & Health check
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'TeamExpense API is running' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'TeamExpense API' });
});

// API Routes (supports both /api/... and /...)
const apiRouter = express.Router();
apiRouter.use('/auth', authRoutes);
apiRouter.use('/', userRoutes);
apiRouter.use('/expenses', expenseRoutes);
apiRouter.use('/', receiptRoutes);
apiRouter.use('/', approvalRoutes);
apiRouter.use('/', commentRoutes);
apiRouter.use('/', reportRoutes);

app.use('/api', apiRouter);
app.use('/', apiRouter);

// Global 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled application error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 5001;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 TeamExpense API running on port ${PORT}`);
    console.log(`📡 URL: http://localhost:${PORT}`);
  });
}

export default app;
