import request from 'supertest';
import app from '../src/app';
import { pool } from '../src/config/db';

describe('Feature 6: Comments & Server-Rendered HTML View', () => {
  let managerCookie: string;
  let managerToken: string;
  let employeeCookie: string;
  let anotherEmployeeCookie: string;
  let otherCompanyManagerCookie: string;
  let testExpenseId: number;
  let anotherEmployeeExpenseId: number;

  beforeAll(async () => {
    // 1. Deliverback Manager (George) login
    const managerLogin = await request(app).post('/auth/login').send({
      email: 'george@deliverback.com',
      password: 'Password123!'
    });
    managerCookie = managerLogin.headers['set-cookie'][0];
    managerToken = managerLogin.body.token;

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

    // 4. Loopcv Manager (Lucas) login
    const loopcvManagerLogin = await request(app).post('/auth/login').send({
      email: 'lucas@loopcv.com',
      password: 'Password123!'
    });
    otherCompanyManagerCookie = loopcvManagerLogin.headers['set-cookie'][0];

    // Create an expense for Alice
    const exp1 = await request(app)
      .post('/expenses')
      .set('Cookie', employeeCookie)
      .send({
        title: 'Team Strategy Dinner',
        amount: 110.00,
        currency: 'USD',
        category: 'Meals'
      });
    testExpenseId = exp1.body.expense.id;

    // Create an expense for Bob
    const exp2 = await request(app)
      .post('/expenses')
      .set('Cookie', anotherEmployeeCookie)
      .send({
        title: 'Software Subscription',
        amount: 25.00,
        currency: 'USD',
        category: 'Software'
      });
    anotherEmployeeExpenseId = exp2.body.expense.id;
  });

  afterAll(async () => {
    // Clean up created test expenses and comments
    if (testExpenseId) {
      await pool.query('DELETE FROM comments WHERE expense_id = $1', [testExpenseId]);
      await pool.query('DELETE FROM expenses WHERE id = $1', [testExpenseId]);
    }
    if (anotherEmployeeExpenseId) {
      await pool.query('DELETE FROM comments WHERE expense_id = $1', [anotherEmployeeExpenseId]);
      await pool.query('DELETE FROM expenses WHERE id = $1', [anotherEmployeeExpenseId]);
    }
    await pool.end();
  });

  describe('POST /expenses/:id/comments', () => {
    it('should reject unauthenticated comment request', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId}/comments`)
        .send({ text: 'Where is the receipt?' });
      expect(res.status).toBe(401);
    });

    it('should reject empty or missing comment text', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId}/comments`)
        .set('Cookie', employeeCookie)
        .send({ text: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('cannot be empty');
    });

    it('should forbid employee from commenting on another employee expense', async () => {
      // Alice attempts to comment on Bob's expense
      const res = await request(app)
        .post(`/expenses/${anotherEmployeeExpenseId}/comments`)
        .set('Cookie', employeeCookie)
        .send({ text: 'Nice expense Bob!' });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('should return 404 for cross-company comment attempt', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId}/comments`)
        .set('Cookie', otherCompanyManagerCookie)
        .send({ text: 'Cross company comment' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Expense not found.');
    });

    it('should allow employee to add a comment on their own expense', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId}/comments`)
        .set('Cookie', employeeCookie)
        .send({ text: 'Receipt attached for the team dinner.' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Comment added successfully.');
      expect(res.body.comment.text).toBe('Receipt attached for the team dinner.');
      expect(res.body.comment.author_role).toBe('employee');
      expect(res.body.comment.author_name).toBeDefined();
    });

    it('should allow manager to add a comment on any company expense', async () => {
      const res = await request(app)
        .post(`/expenses/${testExpenseId}/comments`)
        .set('Cookie', managerCookie)
        .send({ text: 'Approved by management. Good job!' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Comment added successfully.');
      expect(res.body.comment.text).toBe('Approved by management. Good job!');
      expect(res.body.comment.author_role).toBe('manager');
    });
  });

  describe('GET /expenses/:id/view (Server-rendered HTML)', () => {
    it('should reject unauthenticated request with 401 HTML page', async () => {
      const res = await request(app).get(`/expenses/${testExpenseId}/view`);
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Authentication Required');
    });

    it('should forbid employee from viewing another employee expense HTML view', async () => {
      // Alice tries to view Bob's expense
      const res = await request(app)
        .get(`/expenses/${anotherEmployeeExpenseId}/view`)
        .set('Cookie', employeeCookie);
      expect(res.status).toBe(403);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Access Denied');
    });

    it('should return complete server-rendered HTML page for manager', async () => {
      const res = await request(app)
        .get(`/expenses/${testExpenseId}/view`)
        .set('Cookie', managerCookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Team Strategy Dinner');
      expect(res.text).toContain('$110.00');
      expect(res.text).toContain('Meals');
      expect(res.text).toContain('Receipt attached for the team dinner.');
      expect(res.text).toContain('Approved by management. Good job!');
      expect(res.text).toContain('Deliverback');
    });

    it('should allow viewing HTML page via token query parameter (email link)', async () => {
      const res = await request(app)
        .get(`/expenses/${testExpenseId}/view?token=${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Team Strategy Dinner');
    });
  });
});
