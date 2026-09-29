import { Response } from 'express';
import { AuthRequest } from '../types';
import { getClient } from '../config/db';

// 1. POST /expenses/:id/approve: managers only
export async function approveExpense(req: AuthRequest, res: Response): Promise<void> {
  const client = await getClient();

  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) {
      res.status(400).json({ error: 'Invalid expense ID.' });
      return;
    }

    await client.query('BEGIN');

    // Lock the expense row to prevent concurrent race conditions
    const expenseRes = await client.query(
      `SELECT * FROM expenses WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [expenseId, user.companyId]
    );

    if (expenseRes.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    const expense = expenseRes.rows[0];

    // STRICT REQUIREMENT: "An expense must never be approved more than once."
    if (expense.status === 'approved') {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: 'Expense has already been approved. An expense must never be approved more than once.'
      });
      return;
    }

    if (expense.status !== 'pending') {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: `Cannot approve an expense with status '${expense.status}'.`
      });
      return;
    }

    // 1. Update expense status to approved
    const updatedExpenseRes = await client.query(
      `UPDATE expenses
       SET status = 'approved', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [expenseId]
    );

    // 2. Add amount to employee's "total reimbursed" balance
    const updatedUserRes = await client.query(
      `UPDATE users
       SET total_reimbursed = total_reimbursed + $1
       WHERE id = $2
       RETURNING id, full_name, email, role, total_reimbursed`,
      [expense.amount, expense.user_id]
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Expense approved successfully.',
      expense: updatedExpenseRes.rows[0],
      employee: updatedUserRes.rows[0]
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error approving expense:', error);
    res.status(500).json({ error: 'Internal server error while approving expense.' });
  } finally {
    client.release();
  }
}

// 2. POST /expenses/:id/reject: managers only
export async function rejectExpense(req: AuthRequest, res: Response): Promise<void> {
  const client = await getClient();

  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) {
      res.status(400).json({ error: 'Invalid expense ID.' });
      return;
    }

    await client.query('BEGIN');

    // Lock the expense row to prevent concurrent race conditions
    const expenseRes = await client.query(
      `SELECT * FROM expenses WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [expenseId, user.companyId]
    );

    if (expenseRes.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    const expense = expenseRes.rows[0];

    if (expense.status === 'approved') {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: 'Cannot reject an expense that has already been approved.'
      });
      return;
    }

    if (expense.status === 'rejected') {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: 'Expense has already been rejected.'
      });
      return;
    }

    if (expense.status !== 'pending') {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: `Cannot reject an expense with status '${expense.status}'.`
      });
      return;
    }

    // Update expense status to rejected
    const updatedExpenseRes = await client.query(
      `UPDATE expenses
       SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [expenseId]
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Expense rejected successfully.',
      expense: updatedExpenseRes.rows[0]
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error rejecting expense:', error);
    res.status(500).json({ error: 'Internal server error while rejecting expense.' });
  } finally {
    client.release();
  }
}
