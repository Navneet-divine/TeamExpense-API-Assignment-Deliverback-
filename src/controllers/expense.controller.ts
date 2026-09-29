import { Response } from 'express';
import { AuthRequest } from '../types';
import { query } from '../config/db';

const ALLOWED_SORT_COLUMNS = [
  'id',
  'title',
  'amount',
  'currency',
  'category',
  'status',
  'created_at',
  'updated_at'
];

// 1. POST /expenses: create an expense
export async function createExpense(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const { title, amount, currency = 'USD', category } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'Title is required and must be a non-empty string.' });
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number.' });
      return;
    }

    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      res.status(400).json({ error: 'Category is required and must be a non-empty string.' });
      return;
    }

    const currencyCode = (typeof currency === 'string' ? currency.trim().toUpperCase() : 'USD').slice(0, 3);

    const result = await query(
      `INSERT INTO expenses (company_id, user_id, title, amount, currency, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, company_id, user_id, title, amount, currency, category, status, receipt_file, created_at, updated_at`,
      [user.companyId, user.userId, title.trim(), parsedAmount, currencyCode, category.trim()]
    );

    res.status(201).json({
      message: 'Expense created successfully.',
      expense: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Internal server error while creating expense.' });
  }
}

// 2. GET /expenses/:id: view a single expense
export async function getExpenseById(req: AuthRequest, res: Response): Promise<void> {
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

    const result = await query(
      `SELECT e.*, u.full_name AS employee_name, u.email AS employee_email
       FROM expenses e
       JOIN users u ON e.user_id = u.id
       WHERE e.id = $1`,
      [expenseId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    const expense = result.rows[0];

    // Multi-tenant check: Company isolation
    if (expense.company_id !== user.companyId) {
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    // Role-scoping: Employees can only view their own expenses
    if (user.role === 'employee' && expense.user_id !== user.userId) {
      res.status(403).json({ error: 'Forbidden: You can only view your own expenses.' });
      return;
    }

    res.status(200).json({ expense });
  } catch (error: any) {
    console.error('Error fetching expense:', error);
    res.status(500).json({ error: 'Internal server error while fetching expense.' });
  }
}

// 3. PATCH /expenses/:id: edit an expense (only while pending)
export async function updateExpense(req: AuthRequest, res: Response): Promise<void> {
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

    // Fetch existing expense
    const existingResult = await query(
      `SELECT * FROM expenses WHERE id = $1`,
      [expenseId]
    );

    if (existingResult.rowCount === 0) {
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    const expense = existingResult.rows[0];

    // Multi-tenant isolation
    if (expense.company_id !== user.companyId) {
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    // Employees can only edit their own expenses
    if (user.role === 'employee' && expense.user_id !== user.userId) {
      res.status(403).json({ error: 'Forbidden: You can only edit your own expenses.' });
      return;
    }

    // STRICT REQUIREMENT: "edit an expense (only while pending)"
    if (expense.status !== 'pending') {
      res.status(400).json({
        error: `Cannot edit an expense that has already been ${expense.status}. Only pending expenses can be edited.`
      });
      return;
    }

    const { title, amount, currency, category } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        res.status(400).json({ error: 'Title cannot be empty.' });
        return;
      }
      updates.push(`title = $${paramIndex++}`);
      values.push(title.trim());
    }

    if (amount !== undefined) {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        res.status(400).json({ error: 'Amount must be a positive number.' });
        return;
      }
      updates.push(`amount = $${paramIndex++}`);
      values.push(parsedAmount);
    }

    if (currency !== undefined) {
      if (typeof currency !== 'string' || currency.trim().length === 0) {
        res.status(400).json({ error: 'Currency must be a valid code.' });
        return;
      }
      updates.push(`currency = $${paramIndex++}`);
      values.push(currency.trim().toUpperCase().slice(0, 3));
    }

    if (category !== undefined) {
      if (typeof category !== 'string' || category.trim().length === 0) {
        res.status(400).json({ error: 'Category cannot be empty.' });
        return;
      }
      updates.push(`category = $${paramIndex++}`);
      values.push(category.trim());
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields provided for update.' });
      return;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(expenseId);

    const updateSql = `
      UPDATE expenses
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, company_id, user_id, title, amount, currency, category, status, receipt_file, created_at, updated_at
    `;

    const updatedResult = await query(updateSql, values);

    res.status(200).json({
      message: 'Expense updated successfully.',
      expense: updatedResult.rows[0]
    });
  } catch (error: any) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Internal server error while updating expense.' });
  }
}

// 4. GET /expenses: list expenses with search, status filter, sorting, pagination, and role scoping
export async function listExpenses(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const {
      search,
      status,
      category,
      sort_by = 'created_at',
      order = 'desc',
      page = '1',
      limit = '10'
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page as string, 10) || 1);
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 10));
    const offset = (parsedPage - 1) * parsedLimit;

    // Validate sort column (security against SQL injection)
    const normalizedSortBy = ALLOWED_SORT_COLUMNS.includes(sort_by as string)
      ? (sort_by as string)
      : 'created_at';

    // Validate order direction
    const normalizedOrder = (order as string).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Build dynamic WHERE clause
    const conditions: string[] = ['e.company_id = $1'];
    const params: any[] = [user.companyId];
    let paramIndex = 2;

    // Role-scoping: Employees see ONLY their own expenses; Managers see all expenses of their company
    if (user.role === 'employee') {
      conditions.push(`e.user_id = $${paramIndex++}`);
      params.push(user.userId);
    }

    // Status filter (enforce exact match so both search and status must be satisfied)
    if (status && typeof status === 'string' && status.trim().length > 0) {
      conditions.push(`e.status = $${paramIndex++}`);
      params.push(status.trim().toLowerCase());
    }

    // Category filter (if omitted, fetches all categories; if provided, filters strictly)
    if (category && typeof category === 'string' && category.trim().length > 0) {
      conditions.push(`LOWER(e.category) = $${paramIndex++}`);
      params.push(category.trim().toLowerCase());
    }

    // Search filter: free text matched against title and category
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const searchPattern = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(LOWER(e.title) LIKE $${paramIndex} OR LOWER(e.category) LIKE $${paramIndex})`);
      params.push(searchPattern);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // 1. Get total count for pagination
    const countSql = `SELECT COUNT(*) AS total FROM expenses e WHERE ${whereClause}`;
    const countResult = await query(countSql, params);
    const totalCount = parseInt(countResult.rows[0].total, 10);

    // 2. Fetch paginated records
    const dataSql = `
      SELECT e.*, u.full_name AS employee_name, u.email AS employee_email
      FROM expenses e
      JOIN users u ON e.user_id = u.id
      WHERE ${whereClause}
      ORDER BY e.${normalizedSortBy} ${normalizedOrder}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;

    const dataParams = [...params, parsedLimit, offset];
    const dataResult = await query(dataSql, dataParams);

    res.status(200).json({
      pagination: {
        total: totalCount,
        page: parsedPage,
        limit: parsedLimit,
        total_pages: Math.ceil(totalCount / parsedLimit) || 1
      },
      expenses: dataResult.rows
    });
  } catch (error: any) {
    console.error('Error listing expenses:', error);
    res.status(500).json({ error: 'Internal server error while listing expenses.' });
  }
}
