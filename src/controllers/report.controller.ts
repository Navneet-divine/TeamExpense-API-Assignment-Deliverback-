import { Response } from 'express';
import { AuthRequest } from '../types';
import { query } from '../config/db';

/**
 * Escapes a cell for CSV according to RFC 4180 and protects against Excel formula injection.
 */
function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val);

  // Prevent Excel formula injection (CSV Injection / CWE-1236)
  // Spreadsheets ignore leading whitespace and trigger on =, +, -, @, \t, \r, %
  const trimmed = str.trimStart();
  if (/^[=+\-@\t\r%]/.test(trimmed)) {
    str = `'${str}`;
  }

  // Quote cell if it contains delimiter, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

// 7. GET /reports/export.csv: managers download company expenses for a date range as CSV
export async function exportExpensesCsv(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const { from, to } = req.query;

    const conditions: string[] = ['e.company_id = $1'];
    const params: any[] = [user.companyId];
    let paramIndex = 2;

    // Validate and apply 'from' date filter
    if (from && typeof from === 'string' && from.trim().length > 0) {
      const fromDate = new Date(from.trim());
      if (isNaN(fromDate.getTime())) {
        res.status(400).json({ error: 'Invalid "from" date format. Use YYYY-MM-DD.' });
        return;
      }
      // Start of day
      fromDate.setUTCHours(0, 0, 0, 0);
      conditions.push(`e.created_at >= $${paramIndex++}`);
      params.push(fromDate.toISOString());
    }

    // Validate and apply 'to' date filter
    if (to && typeof to === 'string' && to.trim().length > 0) {
      const toDate = new Date(to.trim());
      if (isNaN(toDate.getTime())) {
        res.status(400).json({ error: 'Invalid "to" date format. Use YYYY-MM-DD.' });
        return;
      }
      // End of day
      toDate.setUTCHours(23, 59, 59, 999);
      conditions.push(`e.created_at <= $${paramIndex++}`);
      params.push(toDate.toISOString());
    }

    const sql = `
      SELECT 
        e.title,
        u.full_name AS employee_name,
        e.amount,
        e.currency,
        e.category,
        e.status,
        e.created_at
      FROM expenses e
      JOIN users u ON e.user_id = u.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.created_at DESC
    `;

    const result = await query(sql, params);

    // CSV Header (exact columns required by specification: title, employee name, amount, category, status, date)
    const headerRow = 'Title,Employee Name,Amount,Category,Status,Date';

    const dataRows = result.rows.map((row) => {
      const formattedDate = new Date(row.created_at).toISOString().split('T')[0];
      const formattedAmount = parseFloat(row.amount).toFixed(2);

      return [
        escapeCsvCell(row.title),
        escapeCsvCell(row.employee_name),
        escapeCsvCell(formattedAmount),
        escapeCsvCell(row.category),
        escapeCsvCell(row.status),
        escapeCsvCell(formattedDate)
      ].join(',');
    });

    // UTF-8 BOM (\uFEFF) ensures Excel properly decodes Unicode characters (e.g. Greek, accents, special symbols)
    const csvContent = '\uFEFF' + [headerRow, ...dataRows].join('\r\n');

    const filename = `expenses_export_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error: any) {
    console.error('Error exporting expenses CSV:', error);
    res.status(500).json({ error: 'Internal server error while exporting CSV.' });
  }
}

// 8. GET /reports/summary: total amount per category for current month, manager's company, exact to the cent
export async function getExpenseSummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const now = new Date();
    let startOfMonth: Date;
    let endOfMonth: Date;
    let monthLabel: string;

    const { month } = req.query;

    if (month && typeof month === 'string' && month.trim().length > 0) {
      if (!/^\d{4}-\d{2}$/.test(month.trim())) {
        res.status(400).json({ error: 'Invalid month format. Use YYYY-MM (e.g. 2026-09).' });
        return;
      }
      const [yearStr, monthStr] = month.trim().split('-');
      const year = parseInt(yearStr, 10);
      const parsedMonth = parseInt(monthStr, 10);
      if (parsedMonth < 1 || parsedMonth > 12) {
        res.status(400).json({ error: 'Invalid month value. Must be between 01 and 12.' });
        return;
      }
      startOfMonth = new Date(Date.UTC(year, parsedMonth - 1, 1, 0, 0, 0, 0));
      endOfMonth = new Date(Date.UTC(year, parsedMonth, 1, 0, 0, 0, 0));
      monthLabel = startOfMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    } else {
      // Default: current calendar month
      startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
      monthLabel = startOfMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }

    // 1. Group by category and currency (exact to the cent via Postgres fixed-point NUMERIC)
    const categorySql = `
      SELECT 
        category,
        currency,
        COUNT(*)::INTEGER AS expense_count,
        TO_CHAR(SUM(amount), 'FM999999990.00') AS total_amount
      FROM expenses
      WHERE company_id = $1
        AND created_at >= $2
        AND created_at < $3
      GROUP BY category, currency
      ORDER BY category ASC, currency ASC
    `;

    const categoryResult = await query(categorySql, [
      user.companyId,
      startOfMonth.toISOString(),
      endOfMonth.toISOString()
    ]);

    // 2. Grand totals per currency (exact to the cent)
    const grandTotalSql = `
      SELECT 
        currency,
        COUNT(*)::INTEGER AS total_expenses,
        TO_CHAR(SUM(amount), 'FM999999990.00') AS total_amount
      FROM expenses
      WHERE company_id = $1
        AND created_at >= $2
        AND created_at < $3
      GROUP BY currency
      ORDER BY currency ASC
    `;

    const grandTotalResult = await query(grandTotalSql, [
      user.companyId,
      startOfMonth.toISOString(),
      endOfMonth.toISOString()
    ]);

    res.status(200).json({
      period: {
        month: monthLabel,
        start_date: startOfMonth.toISOString(),
        end_date: endOfMonth.toISOString()
      },
      categories: categoryResult.rows,
      grand_totals: grandTotalResult.rows
    });
  } catch (error: any) {
    console.error('Error generating expense summary:', error);
    res.status(500).json({ error: 'Internal server error while generating summary.' });
  }
}
