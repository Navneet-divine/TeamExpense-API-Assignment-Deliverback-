import request from 'supertest';
import app from '../src/app';
import { pool } from '../src/config/db';

describe('Feature 2: Profile Endpoints (GET /me, PATCH /me)', () => {
  let cookie: string;
  let testUserEmail = `profile_test_${Date.now()}@deliverback.com`;
  const initialPassword = 'Password123!';

  beforeAll(async () => {
    // 1. Get Deliverback company id
    const compRes = await pool.query('SELECT id FROM companies WHERE name = $1', ['Deliverback']);
    const companyId = compRes.rows[0].id;

    // 2. Register user
    await request(app).post('/auth/register').send({
      company_id: companyId,
      email: testUserEmail,
      password: initialPassword,
      full_name: 'Original Name'
    });

    // 3. Login to get token cookie
    const loginRes = await request(app).post('/auth/login').send({
      email: testUserEmail,
      password: initialPassword
    });

    // Extract cookie from response
    cookie = loginRes.headers['set-cookie'][0];
  });

  afterAll(async () => {
    // Cleanup
    await pool.query('DELETE FROM users WHERE email = $1', [testUserEmail.toLowerCase()]);
    await pool.end();
  });

  describe('GET /me', () => {
    it('should reject unauthenticated request without cookie', async () => {
      const res = await request(app).get('/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/authentication required/i);
    });

    it('should return the current user profile when valid cookie is provided', async () => {
      const res = await request(app).get('/me').set('Cookie', [cookie]);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUserEmail.toLowerCase());
      expect(res.body.user.full_name).toBe('Original Name');
      expect(res.body.user.company_name).toBe('Deliverback');
      expect(res.body.user.role).toBe('employee');
      expect(res.body.user.password).toBeUndefined();
    });
  });

  describe('PATCH /me', () => {
    it('should reject unauthenticated request', async () => {
      const res = await request(app).patch('/me').send({ full_name: 'New Name' });
      expect(res.status).toBe(401);
    });

    it('should update full_name successfully', async () => {
      const res = await request(app)
        .patch('/me')
        .set('Cookie', [cookie])
        .send({ full_name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.user.full_name).toBe('Updated Name');
    });

    it('should reject updates with only unauthorized fields like role or total_reimbursed', async () => {
      const res = await request(app)
        .patch('/me')
        .set('Cookie', [cookie])
        .send({ role: 'manager', total_reimbursed: 99999 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No valid fields provided for update/i);
    });

    it('should reject password update if old_password is missing', async () => {
      const res = await request(app)
        .patch('/me')
        .set('Cookie', [cookie])
        .send({ new_password: 'NewPassword123!' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/old_password is required/i);
    });

    it('should reject password update if old_password is wrong', async () => {
      const res = await request(app)
        .patch('/me')
        .set('Cookie', [cookie])
        .send({
          old_password: 'WrongOldPassword!',
          new_password: 'NewPassword123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Incorrect old password/i);
    });

    it('should update password when correct old_password is provided', async () => {
      const newPassword = 'UpdatedPassword456!';
      const res = await request(app)
        .patch('/me')
        .set('Cookie', [cookie])
        .send({
          old_password: initialPassword,
          new_password: newPassword
        });

      expect(res.status).toBe(200);

      // Verify login works with the updated password
      const loginRes = await request(app).post('/auth/login').send({
        email: testUserEmail,
        password: newPassword
      });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();
    });
  });
});
