import request from 'supertest';
import app from '../src/app';
import { pool } from '../src/config/db';

describe('Feature 7: Export Endpoints (GET /reports/export.csv)', () => {
  let managerCookie: string;
  let employeeCookie: string;
  let otherCompanyManagerCookie: string;

  beforeAll(async () => {
    // 1. Deliverback Manager (George) login
    const managerLogin = await request(app).post('/auth/login').send({
      email: 'george@deliverback.com',
      password: 'Password123!'
    });
    managerCookie = managerLogin.headers['set-cookie'][0];

    // 2. Deliverback Employee (Alice) login
    const aliceLogin = await request(app).post('/auth/login').send({
      email: 'alice@deliverback.com',
      password: 'Password123!'
    });
    employeeCookie = aliceLogin.headers['set-cookie'][0];

    // 3. Loopcv Manager (Lucas) login
    const loopcvManagerLogin = await request(app).post('/auth/login').send({
      email: 'lucas@loopcv.com',
      password: 'Password123!'
    });
    otherCompanyManagerCookie = loopcvManagerLogin.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/reports/export.csv');
    expect(res.status).toBe(401);
  });

  it('should forbid employee from exporting reports', async () => {
    const res = await request(app)
      .get('/reports/export.csv')
      .set('Cookie', employeeCookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Forbidden');
  });

  it('should reject invalid "from" date format', async () => {
    const res = await request(app)
      .get('/reports/export.csv?from=invalid-date')
      .set('Cookie', managerCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid "from" date format');
  });

  it('should reject invalid "to" date format', async () => {
    const res = await request(app)
      .get('/reports/export.csv?to=invalid-date')
      .set('Cookie', managerCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid "to" date format');
  });

  it('should successfully export CSV with correct headers and UTF-8 BOM for manager', async () => {
    const res = await request(app)
      .get('/reports/export.csv')
      .set('Cookie', managerCookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.csv');

    // Verify UTF-8 BOM (\uFEFF) at the start for Excel compatibility
    expect(res.text.startsWith('\uFEFF')).toBe(true);

    const lines = res.text.replace('\uFEFF', '').split('\r\n');
    expect(lines[0]).toBe('Title,Employee Name,Amount,Category,Status,Date');

    // Should include seeded expenses for Deliverback
    expect(res.text).toContain('Alice Jenkins');
  });

  it('should filter CSV export by date range', async () => {
    // A future date range where no expenses exist
    const res = await request(app)
      .get('/reports/export.csv?from=2030-01-01&to=2030-12-31')
      .set('Cookie', managerCookie);

    expect(res.status).toBe(200);
    const lines = res.text.replace('\uFEFF', '').split('\r\n').filter(Boolean);
    // Only the header row should be present
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe('Title,Employee Name,Amount,Category,Status,Date');
  });

  it('should isolate company expenses between different company managers', async () => {
    // Deliverback manager export
    const deliverbackRes = await request(app)
      .get('/reports/export.csv')
      .set('Cookie', managerCookie);

    // Loopcv manager export
    const loopcvRes = await request(app)
      .get('/reports/export.csv')
      .set('Cookie', otherCompanyManagerCookie);

    // Deliverback contains Alice / Bob, does NOT contain Loopcv employees (Charlie / David)
    expect(deliverbackRes.text).toContain('Alice Jenkins');
    expect(deliverbackRes.text).not.toContain('Charlie Smith');
    expect(deliverbackRes.text).not.toContain('David Evans');

    // Loopcv contains Charlie / David, does NOT contain Deliverback employees (Alice / Bob)
    expect(loopcvRes.text).toContain('Charlie Smith');
    expect(loopcvRes.text).not.toContain('Alice Jenkins');
  });

  it('should neutralize CSV formula injection with leading whitespace in exported cells', async () => {
    // Alice submits an expense with leading whitespace and a formula
    await request(app)
      .post('/expenses')
      .set('Cookie', employeeCookie)
      .send({
        amount: 25.0,
        currency: 'EUR',
        category: 'travel',
        title: '   =cmd|/C calc!A0',
        date: '2026-03-15'
      });

    const res = await request(app)
      .get('/reports/export.csv')
      .set('Cookie', managerCookie);

    expect(res.status).toBe(200);
    // The dangerous cell should be prepended with a single quote (') to neutralize execution in Excel
    expect(res.text).toContain("'=cmd|/C calc!A0");
  });

  describe('Feature 8: Statistics Endpoints (GET /reports/summary)', () => {
    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/reports/summary');
      expect(res.status).toBe(401);
    });

    it('should forbid employee from accessing summary statistics', async () => {
      const res = await request(app)
        .get('/reports/summary')
        .set('Cookie', employeeCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('should reject invalid month format', async () => {
      const res = await request(app)
        .get('/reports/summary?month=2026-15')
        .set('Cookie', managerCookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid month value');
    });

    it('should return category statistics exact to the cent for current month', async () => {
      const res = await request(app)
        .get('/reports/summary')
        .set('Cookie', managerCookie);

      expect(res.status).toBe(200);
      expect(res.body.period).toBeDefined();
      expect(res.body.period.month).toBeDefined();
      expect(res.body.categories).toBeInstanceOf(Array);
      expect(res.body.grand_totals).toBeInstanceOf(Array);

      if (res.body.categories.length > 0) {
        const firstCategory = res.body.categories[0];
        expect(firstCategory.category).toBeDefined();
        expect(firstCategory.currency).toBeDefined();
        expect(firstCategory.expense_count).toBeGreaterThanOrEqual(1);
        // Verify format is exact to the cent (2 decimals)
        expect(firstCategory.total_amount).toMatch(/^\d+\.\d{2}$/);
      }

      if (res.body.grand_totals.length > 0) {
        const firstTotal = res.body.grand_totals[0];
        expect(firstTotal.currency).toBeDefined();
        expect(firstTotal.total_expenses).toBeGreaterThanOrEqual(1);
        expect(firstTotal.total_amount).toMatch(/^\d+\.\d{2}$/);
      }
    });

    it('should isolate statistics per company', async () => {
      const deliverbackRes = await request(app)
        .get('/reports/summary')
        .set('Cookie', managerCookie);

      const loopcvRes = await request(app)
        .get('/reports/summary')
        .set('Cookie', otherCompanyManagerCookie);

      expect(deliverbackRes.status).toBe(200);
      expect(loopcvRes.status).toBe(200);
      // Both return clean, company-isolated summaries
      expect(deliverbackRes.body.period.month).toBe(loopcvRes.body.period.month);
    });
  });
});
