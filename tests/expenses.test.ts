import request from 'supertest';
import app from '../src/app';
import { pool } from '../src/config/db';

describe('Feature 3: Expenses Endpoints', () => {
  let employeeCookie: string;
  let anotherEmployeeCookie: string;
  let managerCookie: string;
  let createdExpenseId: number;
  let approvedExpenseId: number;

  beforeAll(async () => {
    // 1. Deliverback Manager login
    const managerLogin = await request(app).post('/auth/login').send({
      email: 'george@deliverback.com',
      password: 'Password123!'
    });
    managerCookie = managerLogin.headers['set-cookie'][0];

    // 2. Deliverback Employee 1 (Alice) login
    const aliceLogin = await request(app).post('/auth/login').send({
      email: 'alice@deliverback.com',
      password: 'Password123!'
    });
    employeeCookie = aliceLogin.headers['set-cookie'][0];

    // 3. Deliverback Employee 2 (Bob) login
    const bobLogin = await request(app).post('/auth/login').send({
      email: 'bob@deliverback.com',
      password: 'Password123!'
    });
    anotherEmployeeCookie = bobLogin.headers['set-cookie'][0];

    // Find an approved expense seeded for Alice
    const approvedRes = await pool.query(
      `SELECT id FROM expenses WHERE status = 'approved' LIMIT 1`
    );
    approvedExpenseId = approvedRes.rows[0].id;
  });

  afterAll(async () => {
    // Clean up created test expense
    if (createdExpenseId) {
      await pool.query('DELETE FROM expenses WHERE id = $1', [createdExpenseId]);
    }
    await pool.end();
  });

  describe('POST /expenses', () => {
    it('should reject unauthenticated request', async () => {
      const res = await request(app).post('/expenses').send({
        title: 'Lunch',
        amount: 50.0,
        category: 'Meals'
      });
      expect(res.status).toBe(401);
    });

    it('should reject negative or zero amount', async () => {
      const res = await request(app)
        .post('/expenses')
        .set('Cookie', [employeeCookie])
        .send({
          title: 'Invalid',
          amount: -10,
          category: 'Meals'
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/positive number/i);
    });

    it('should create an expense with pending status', async () => {
      const res = await request(app)
        .post('/expenses')
        .set('Cookie', [employeeCookie])
        .send({
          title: 'Office Supplies Box',
          amount: 75.5,
          currency: 'USD',
          category: 'Office Supplies'
        });

      expect(res.status).toBe(201);
      expect(res.body.expense).toBeDefined();
      expect(res.body.expense.title).toBe('Office Supplies Box');
      expect(parseFloat(res.body.expense.amount)).toBe(75.5);
      expect(res.body.expense.status).toBe('pending');

      createdExpenseId = res.body.expense.id;
    });
  });

  describe('GET /expenses/:id', () => {
    it('should allow employee to view their own expense', async () => {
      const res = await request(app)
        .get(`/expenses/${createdExpenseId}`)
        .set('Cookie', [employeeCookie]);

      expect(res.status).toBe(200);
      expect(res.body.expense.id).toBe(createdExpenseId);
    });

    it('should forbid employee from viewing another employee’s expense', async () => {
      const res = await request(app)
        .get(`/expenses/${createdExpenseId}`)
        .set('Cookie', [anotherEmployeeCookie]);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/forbidden/i);
    });

    it('should allow manager to view any expense in their company', async () => {
      const res = await request(app)
        .get(`/expenses/${createdExpenseId}`)
        .set('Cookie', [managerCookie]);

      expect(res.status).toBe(200);
      expect(res.body.expense.id).toBe(createdExpenseId);
    });
  });

  describe('PATCH /expenses/:id', () => {
    it('should allow editing an expense while it is pending', async () => {
      const res = await request(app)
        .patch(`/expenses/${createdExpenseId}`)
        .set('Cookie', [employeeCookie])
        .send({
          title: 'Office Supplies Box (Updated)',
          amount: 80.0
        });

      expect(res.status).toBe(200);
      expect(res.body.expense.title).toBe('Office Supplies Box (Updated)');
      expect(parseFloat(res.body.expense.amount)).toBe(80.0);
    });

    it('should forbid editing an expense if it is not pending', async () => {
      const res = await request(app)
        .patch(`/expenses/${approvedExpenseId}`)
        .set('Cookie', [employeeCookie])
        .send({
          title: 'Attempted Edit On Approved'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Only pending expenses can be edited/i);
    });
  });

  describe('GET /expenses (list, filter, search, sort, pagination)', () => {
    it('should scope list to own expenses for employees', async () => {
      const res = await request(app)
        .get('/expenses')
        .set('Cookie', [employeeCookie]);

      expect(res.status).toBe(200);
      expect(res.body.expenses).toBeDefined();
      expect(Array.isArray(res.body.expenses)).toBe(true);

      // Verify all returned expenses belong to Alice
      const allMine = res.body.expenses.every((exp: any) => exp.employee_email === 'alice@deliverback.com');
      expect(allMine).toBe(true);
    });

    it('should allow manager to see all company expenses', async () => {
      const res = await request(app)
        .get('/expenses')
        .set('Cookie', [managerCookie]);

      expect(res.status).toBe(200);
      expect(res.body.expenses.length).toBeGreaterThan(1);
    });

    it('should filter expenses by status', async () => {
      const res = await request(app)
        .get('/expenses?status=approved')
        .set('Cookie', [managerCookie]);

      expect(res.status).toBe(200);
      const allApproved = res.body.expenses.every((exp: any) => exp.status === 'approved');
      expect(allApproved).toBe(true);
    });

    it('should search by keyword in title or category', async () => {
      const res = await request(app)
        .get('/expenses?search=Supplies')
        .set('Cookie', [managerCookie]);

      expect(res.status).toBe(200);
      expect(res.body.expenses.length).toBeGreaterThan(0);
    });

    it('should filter expenses by category', async () => {
      const res = await request(app)
        .get('/expenses?category=Meals')
        .set('Cookie', [managerCookie]);

      expect(res.status).toBe(200);
      expect(res.body.expenses.length).toBeGreaterThan(0);
      const allMeals = res.body.expenses.every((exp: any) => exp.category.toLowerCase() === 'meals');
      expect(allMeals).toBe(true);
    });

    it('should sort expenses by amount ascending', async () => {
      const res = await request(app)
        .get('/expenses?sort_by=amount&order=asc')
        .set('Cookie', [managerCookie]);

      expect(res.status).toBe(200);
      expect(res.body.expenses.length).toBeGreaterThan(1);
      const amounts = res.body.expenses.map((exp: any) => parseFloat(exp.amount));
      for (let i = 0; i < amounts.length - 1; i++) {
        expect(amounts[i]).toBeLessThanOrEqual(amounts[i + 1]);
      }
    });

    it('should support pagination (page and limit)', async () => {
      const res = await request(app)
        .get('/expenses?page=1&limit=2')
        .set('Cookie', [managerCookie]);

      expect(res.status).toBe(200);
      expect(res.body.expenses.length).toBeLessThanOrEqual(2);
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.pagination.page).toBe(1);
    });
  });
});
