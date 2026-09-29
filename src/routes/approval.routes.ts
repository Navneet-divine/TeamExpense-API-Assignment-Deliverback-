import { Router } from 'express';
import { approveExpense, rejectExpense } from '../controllers/approval.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// 5. Approval (managers only)
// POST /expenses/:id/approve: approve an expense and update employee's total reimbursed balance
router.post('/expenses/:id/approve', authenticate, requireRole('manager'), approveExpense);

// POST /expenses/:id/reject: reject an expense
router.post('/expenses/:id/reject', authenticate, requireRole('manager'), rejectExpense);

export default router;
