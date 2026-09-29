import request from 'supertest';
import app from '../src/app';
import { pool } from '../src/config/db';

describe('Feature 5: Approval Endpoints', () => {
  let managerCookie: string;
  let employeeCookie: string;
  let otherCompanyManagerCookie: string;
  let testExpenseId1: number;
  let testExpenseId2: number;
  let employeeUserId: number;

  beforeAll(async () => {
    // 1. Deliverback Manager (George) login
    const managerLogin = await request(app).post('/auth/login').send({
      email: 'george@deliverback.com',
      password: 'Password123!'
    });
    managerCookie = managerLogin.headers['set-cookie'][0];

    // 2. Deliverback Employee (Alice) login
    const employeeLogin = await request(app).post('/auth/login').send({
      email: 'alice@deliverback.com',
      password: 'Password123!'
    });
    employeeCookie = employeeLogin.headers['set-cookie'][0];
    employeeUserId = employeeLogin.body.user.id;

    // 3. Loopcv Manager (Lucas) login
    const loopcvManagerLogin = await request(app).post('/auth/login').send({
      email: 'lucas@loopcv.com',
      password: 'Password123!'
    });
    otherCompanyManagerCookie = loopcvManagerLogin.headers['set-cookie'][0];

    // Create 2 fresh pending expenses for Alice in Deliverback
    const exp1 = await request(app)
      .post('/expenses')
      .set('Cookie', employeeCookie)
      .send({
        title: 'Team Coffee Approval Test',
        amount: 45.50,
        currency: 'USD',
        category: 'Meals'
      });
    testExpenseId1 = exp1.body.expense.id;

    const exp2 = await request(app)
      .post('/expenses')
      .set('Cookie', employeeCookie)
      .send({
        title: 'Office Stationery Rejection Test',
        amount: 30.00,
        currency: 'USD',
        category: 'Supplies'
      });
    testExpenseId2 = exp2.body.expense.id;
  });

  afterAll(async () => {
    // Clean up created test expenses
    if (testExpenseId1) {
      await pool.query('DELETE FROM expenses WHERE id = $1', [testExpenseId1]);
    }
    if (testExpenseId2) {
      await pool.query('DELETE FROM expenses WHERE id = $1', [testExpenseId2]);
    }
    await pool.end();
  });

  describe('POST /expenses/:id/approve', () => {
    it('should reject unauthenticated request', async () => {
      const res = await request(app).post(`/expenses/${testExpenseId1}/approve`);
      expect(res.status).toBe(401);
    });

    it('should forbid employee from approving an expense', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId1}/approve`)
        .set('Cookie', employeeCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('should return 404 if a manager from another company tries to approve', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId1}/approve`)
        .set('Cookie', otherCompanyManagerCookie);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Expense not found.');
    });

    it('should return 400 for invalid expense ID', async () => {
      const res = await request(app)
        .post('/expenses/invalid-id/approve')
        .set('Cookie', managerCookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid expense ID.');
    });

    it('should successfully approve a pending expense and update employee total reimbursed balance', async () => {
      // Get current balance of Alice before approval
      const userBefore = await pool.query('SELECT total_reimbursed FROM users WHERE id = $1', [employeeUserId]);
      const initialBalance = parseFloat(userBefore.rows[0].total_reimbursed);

      const res = await request(app)
        .post(`/expenses/${testExpenseId1}/approve`)
        .set('Cookie', managerCookie);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Expense approved successfully.');
      expect(res.body.expense.status).toBe('approved');

      // Verify user total_reimbursed in DB
      const userAfter = await pool.query('SELECT total_reimbursed FROM users WHERE id = $1', [employeeUserId]);
      const updatedBalance = parseFloat(userAfter.rows[0].total_reimbursed);
      expect(updatedBalance).toBeCloseTo(initialBalance + 45.50, 2);

      // Verify GET /me returns updated total_reimbursed for employee
      const meRes = await request(app)
        .get('/me')
        .set('Cookie', employeeCookie);
      expect(meRes.status).toBe(200);
      expect(parseFloat(meRes.body.user.total_reimbursed)).toBeCloseTo(updatedBalance, 2);
    });

    it('should never allow an expense to be approved more than once', async () => {
      // Attempting to approve testExpenseId1 again
      const res = await request(app)
        .post(`/expenses/${testExpenseId1}/approve`)
        .set('Cookie', managerCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already been approved');
    });
  });

  describe('POST /expenses/:id/reject', () => {
    it('should reject unauthenticated request', async () => {
      const res = await request(app).post(`/expenses/${testExpenseId2}/reject`);
      expect(res.status).toBe(401);
    });

    it('should forbid employee from rejecting an expense', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId2}/reject`)
        .set('Cookie', employeeCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('should return 404 if a manager from another company tries to reject', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId2}/reject`)
        .set('Cookie', otherCompanyManagerCookie);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Expense not found.');
    });

    it('should return 400 when trying to reject an already approved expense', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId1}/reject`)
        .set('Cookie', managerCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already been approved');
    });

    it('should successfully reject a pending expense', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId2}/reject`)
        .set('Cookie', managerCookie);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Expense rejected successfully.');
      expect(res.body.expense.status).toBe('rejected');
    });

    it('should reject already rejected expense when trying to reject again', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId2}/reject`)
        .set('Cookie', managerCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Expense has already been rejected.');
    });

    it('should forbid approving an already rejected expense', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId2}/approve`)
        .set('Cookie', managerCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('rejected');
    });
  });
});
