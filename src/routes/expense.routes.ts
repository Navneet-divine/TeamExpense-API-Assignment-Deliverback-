import { Router } from 'express';
import {
  createExpense,
  getExpenseById,
  updateExpense,
  listExpenses
} from '../controllers/expense.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// 3. Expenses
// POST /expenses: create an expense
router.post('/', authenticate, createExpense);

// GET /expenses: list expenses (search, status filter, sort_by, order, page, limit, role-scoped)
router.get('/', authenticate, listExpenses);

// GET /expenses/:id: view a single expense
router.get('/:id', authenticate, getExpenseById);

// PATCH /expenses/:id: edit an expense (only while pending)
router.patch('/:id', authenticate, updateExpense);

export default router;
