import { Router } from 'express';
import { exportExpensesCsv, getExpenseSummary } from '../controllers/report.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// 7. Export (managers only)
// GET /reports/export.csv: download company expenses as CSV
router.get('/reports/export.csv', authenticate, requireRole('manager'), exportExpensesCsv);

// 8. Statistics (managers only)
// GET /reports/summary: total amount per category for current month, manager's company, exact to the cent
router.get('/reports/summary', authenticate, requireRole('manager'), getExpenseSummary);

export default router;
