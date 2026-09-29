import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, AuthUserPayload } from '../types';
import { query } from '../config/db';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_teamexpense_2026';

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 1. POST /expenses/:id/comments: add a comment
export async function addComment(req: AuthRequest, res: Response): Promise<void> {
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

    const { text } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Comment text is required and cannot be empty.' });
      return;
    }

    // Check expense existence and multi-tenant isolation
    const expenseRes = await query(
      `SELECT id, company_id, user_id FROM expenses WHERE id = $1`,
      [expenseId]
    );

    if (expenseRes.rowCount === 0) {
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    const expense = expenseRes.rows[0];

    // Multi-tenant check
    if (expense.company_id !== user.companyId) {
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    // Role-scoping: Employees can only comment on their own expenses; managers can comment on all company expenses
    if (user.role === 'employee' && expense.user_id !== user.userId) {
      res.status(403).json({ error: 'Forbidden: You can only comment on your own expenses.' });
      return;
    }

    // Insert comment
    const insertRes = await query(
      `INSERT INTO comments (expense_id, user_id, text)
       VALUES ($1, $2, $3)
       RETURNING id, expense_id, user_id, text, created_at`,
      [expenseId, user.userId, text.trim()]
    );

    const newComment = insertRes.rows[0];

    // Fetch author details for complete response
    const authorRes = await query(
      `SELECT full_name, role FROM users WHERE id = $1`,
      [user.userId]
    );
    const author = authorRes.rows[0];

    res.status(201).json({
      message: 'Comment added successfully.',
      comment: {
        id: newComment.id,
        expense_id: newComment.expense_id,
        user_id: newComment.user_id,
        text: newComment.text,
        created_at: newComment.created_at,
        author_name: author?.full_name,
        author_role: author?.role
      }
    });
  } catch (error: any) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Internal server error while adding comment.' });
  }
}

// 2. GET /expenses/:id/view: server-rendered HTML page showing expense details and comments
export async function renderExpenseView(req: Request, res: Response): Promise<void> {
  try {
    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) {
      res.status(400).send(renderErrorPage(400, 'Invalid Expense ID', 'The expense ID provided in the URL is invalid.'));
      return;
    }

    // Resolve user from cookie, Bearer token, or query param
    const token =
      req.cookies?.token ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) ||
      (typeof req.query?.token === 'string' ? req.query.token : null);

    let user: AuthUserPayload | null = null;
    if (token) {
      try {
        user = jwt.verify(token, JWT_SECRET) as AuthUserPayload;
      } catch (err) {
        user = null;
      }
    }

    if (!user) {
      res.status(401).send(
        renderErrorPage(
          401,
          'Authentication Required',
          'You need to be logged in to view this expense. Please log in to your TeamExpense account.'
        )
      );
      return;
    }

    // Query expense with submitter and company info
    const expenseRes = await query(
      `SELECT e.*, u.full_name AS employee_name, u.email AS employee_email, c.name AS company_name
       FROM expenses e
       JOIN users u ON e.user_id = u.id
       JOIN companies c ON e.company_id = c.id
       WHERE e.id = $1`,
      [expenseId]
    );

    if (expenseRes.rowCount === 0) {
      res.status(404).send(renderErrorPage(404, 'Expense Not Found', 'The requested expense does not exist.'));
      return;
    }

    const expense = expenseRes.rows[0];

    // Multi-tenant isolation
    if (expense.company_id !== user.companyId) {
      res.status(404).send(renderErrorPage(404, 'Expense Not Found', 'The requested expense does not exist.'));
      return;
    }

    // Role check: employees can only view their own expenses
    if (user.role === 'employee' && expense.user_id !== user.userId) {
      res.status(403).send(
        renderErrorPage(403, 'Access Denied', 'You do not have permission to view expenses submitted by other employees.')
      );
      return;
    }

    // Fetch all comments for this expense
    const commentsRes = await query(
      `SELECT c.id, c.expense_id, c.user_id, c.text, c.created_at, u.full_name AS author_name, u.role AS author_role
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.expense_id = $1
       ORDER BY c.created_at ASC`,
      [expenseId]
    );

    const comments = commentsRes.rows;

    const html = generateExpenseHtml(expense, comments, user);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error: any) {
    console.error('Error rendering expense view:', error);
    res.status(500).send(renderErrorPage(500, 'Server Error', 'An unexpected error occurred while loading the expense.'));
  }
}

function renderErrorPage(status: number, title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - TeamExpense</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background: #0f172a; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; max-width: 480px; width: 100%; padding: 32px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .code { font-size: 48px; font-weight: 800; color: #ef4444; margin-bottom: 12px; }
    h1 { font-size: 22px; margin-bottom: 12px; color: #f8fafc; }
    p { color: #94a3b8; font-size: 15px; line-height: 1.5; margin-bottom: 24px; }
    .btn { display: inline-block; background: #3b82f6; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 14px; }
    .btn:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="card">
    <div class="code">${status}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/" class="btn">Return to TeamExpense</a>
  </div>
</body>
</html>`;
}

function generateExpenseHtml(expense: any, comments: any[], currentUser: AuthUserPayload): string {
  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    pending: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
    approved: { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
    rejected: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' }
  };

  const statusStyle = statusColors[expense.status] || statusColors.pending;
  const formattedDate = new Date(expense.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const commentsListHtml = comments.length === 0
    ? `<div class="empty-comments">No comments yet on this expense.</div>`
    : comments.map(c => {
        const cDate = new Date(c.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        const isManager = c.author_role === 'manager';
        return `
          <div class="comment-item">
            <div class="comment-header">
              <span class="author-name">${escapeHtml(c.author_name)}</span>
              <span class="role-badge ${isManager ? 'role-manager' : 'role-employee'}">${escapeHtml(c.author_role)}</span>
              <span class="comment-date">${cDate}</span>
            </div>
            <div class="comment-text">${escapeHtml(c.text)}</div>
          </div>
        `;
      }).join('');

  const receiptHtml = expense.receipt_file
    ? `<div class="receipt-box">
         <span class="label">Attached Receipt:</span>
         <a href="/receipts/${encodeURIComponent(expense.receipt_file)}" target="_blank" class="receipt-link">
           📎 View / Download Receipt (${escapeHtml(expense.receipt_file)})
         </a>
       </div>`
    : `<div class="no-receipt">No receipt attached.</div>`;

  const managerActionsHtml = (currentUser.role === 'manager' && expense.status === 'pending')
    ? `<div class="actions-card">
         <h3>Manager Actions</h3>
         <div class="actions-buttons">
           <button class="btn btn-approve" onclick="handleAction('approve')">✓ Approve Expense</button>
           <button class="btn btn-reject" onclick="handleAction('reject')">✕ Reject Expense</button>
         </div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Expense #${expense.id} - ${escapeHtml(expense.title)} | TeamExpense</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background: #0f172a; color: #f8fafc; padding: 32px 16px; min-height: 100vh; }
    .container { max-width: 780px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #334155; }
    .logo { font-size: 20px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .company { font-size: 14px; color: #94a3b8; background: #1e293b; padding: 6px 12px; border-radius: 6px; border: 1px solid #334155; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 28px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .expense-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .expense-title { font-size: 24px; font-weight: 700; color: #f8fafc; margin-bottom: 6px; }
    .meta-sub { color: #94a3b8; font-size: 14px; }
    .amount-badge { text-align: right; }
    .amount { font-size: 28px; font-weight: 800; color: #38bdf8; }
    .currency { font-size: 14px; color: #94a3b8; font-weight: 500; }
    .status-pill { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid ${statusStyle.border}; background: ${statusStyle.bg}; color: ${statusStyle.text}; margin-top: 8px; }
    .details-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; padding: 16px; background: #0f172a; border-radius: 8px; margin-bottom: 20px; border: 1px solid #334155; }
    .grid-item .label { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; }
    .grid-item .value { font-size: 15px; color: #e2e8f0; font-weight: 500; }
    .receipt-box { padding: 12px 16px; background: #0f172a; border-radius: 8px; border: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; }
    .receipt-link { color: #38bdf8; text-decoration: none; font-weight: 500; font-size: 14px; }
    .receipt-link:hover { text-decoration: underline; }
    .no-receipt { font-size: 14px; color: #64748b; font-style: italic; }
    .actions-card { background: #1e293b; border: 1px solid #3b82f6; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .actions-card h3 { font-size: 16px; margin-bottom: 12px; color: #93c5fd; }
    .actions-buttons { display: flex; gap: 12px; }
    .btn { padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: 0.2s; }
    .btn-approve { background: #10b981; color: white; }
    .btn-approve:hover { background: #059669; }
    .btn-reject { background: #ef4444; color: white; }
    .btn-reject:hover { background: #dc2626; }
    .section-title { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #f8fafc; display: flex; align-items: center; justify-content: space-between; }
    .comments-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
    .comment-item { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; }
    .comment-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .author-name { font-weight: 600; font-size: 14px; color: #f1f5f9; }
    .role-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
    .role-manager { background: #3b82f6; color: white; }
    .role-employee { background: #475569; color: #cbd5e1; }
    .comment-date { font-size: 12px; color: #64748b; margin-left: auto; }
    .comment-text { font-size: 14px; color: #cbd5e1; line-height: 1.5; white-space: pre-wrap; }
    .empty-comments { text-align: center; color: #64748b; padding: 24px; font-style: italic; background: #0f172a; border-radius: 8px; border: 1px dashed #334155; }
    .comment-form { display: flex; flex-direction: column; gap: 12px; }
    .comment-textarea { width: 100%; min-height: 90px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px; color: #f8fafc; font-size: 14px; resize: vertical; }
    .comment-textarea:focus { outline: none; border-color: #38bdf8; }
    .btn-submit { align-self: flex-end; background: #38bdf8; color: #0f172a; font-weight: 700; padding: 10px 24px; border-radius: 6px; border: none; cursor: pointer; }
    .btn-submit:hover { background: #0284c7; color: white; }
    .feedback-banner { padding: 12px; border-radius: 6px; font-size: 14px; margin-bottom: 12px; display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">⚡ TeamExpense</div>
      <div class="company">${escapeHtml(expense.company_name)}</div>
    </div>

    <div class="card">
      <div class="expense-top">
        <div>
          <h1 class="expense-title">${escapeHtml(expense.title)}</h1>
          <div class="meta-sub">Submitted by <strong>${escapeHtml(expense.employee_name)}</strong> (${escapeHtml(expense.employee_email)}) on ${formattedDate}</div>
        </div>
        <div class="amount-badge">
          <div class="amount">$${parseFloat(expense.amount).toFixed(2)}</div>
          <div class="currency">${escapeHtml(expense.currency)}</div>
          <div><span class="status-pill">${escapeHtml(expense.status)}</span></div>
        </div>
      </div>

      <div class="details-grid">
        <div class="grid-item">
          <div class="label">Category</div>
          <div class="value">${escapeHtml(expense.category)}</div>
        </div>
        <div class="grid-item">
          <div class="label">Expense ID</div>
          <div class="value">#${expense.id}</div>
        </div>
        <div class="grid-item">
          <div class="label">Current Status</div>
          <div class="value">${escapeHtml(expense.status.toUpperCase())}</div>
        </div>
      </div>

      ${receiptHtml}
    </div>

    ${managerActionsHtml}

    <div class="card">
      <div class="section-title">
        <span>Comments & Discussion (${comments.length})</span>
      </div>

      <div class="comments-list">
        ${commentsListHtml}
      </div>

      <div id="feedback" class="feedback-banner"></div>

      <form class="comment-form" onsubmit="submitComment(event)">
        <textarea id="commentText" class="comment-textarea" placeholder="Add a comment or inquiry regarding this expense..." required></textarea>
        <button type="submit" class="btn-submit">Post Comment</button>
      </form>
    </div>
  </div>

  <script>
    async function submitComment(e) {
      e.preventDefault();
      const text = document.getElementById('commentText').value.trim();
      if (!text) return;

      try {
        const res = await fetch('/expenses/${expense.id}/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        if (res.ok) {
          window.location.reload();
        } else {
          const data = await res.json();
          alert(data.error || 'Failed to post comment.');
        }
      } catch (err) {
        alert('Error connecting to server.');
      }
    }

    async function handleAction(action) {
      if (!confirm('Are you sure you want to ' + action + ' this expense?')) return;
      try {
        const res = await fetch('/expenses/${expense.id}/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (res.ok) {
          alert(data.message || 'Expense ' + action + 'd successfully.');
          window.location.reload();
        } else {
          alert(data.error || 'Failed to ' + action + ' expense.');
        }
      } catch (err) {
        alert('Network error.');
      }
    }
  </script>
</body>
</html>`;
}
