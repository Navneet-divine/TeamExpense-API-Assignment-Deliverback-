import request from 'supertest';
import crypto from 'crypto';
import app from '../src/app';
import { pool } from '../src/config/db';

describe('Feature 1: Authentication Endpoints', () => {
  let companyId: number;
  const testEmail = `employee_${Date.now()}@deliverback.com`;
  const testPassword = 'Password123!';
  let resetToken = '';

  beforeAll(async () => {
    // Grab the first existing company (Deliverback)
    const res = await pool.query('SELECT id FROM companies LIMIT 1');
    companyId = res.rows[0].id;
  });

  afterAll(async () => {
    // Clean up created test user
    await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
    await pool.end();
  });

  describe('POST /auth/register', () => {
    it('should fail if required fields are missing', async () => {
      const res = await request(app).post('/auth/register').send({
        email: 'missing@example.com'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should fail if company does not exist', async () => {
      const res = await request(app).post('/auth/register').send({
        company_id: 999999,
        email: `random_${Date.now()}@deliverback.com`,
        password: 'Password123!',
        full_name: 'Ghost User'
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Company with id .* does not exist/);
    });

    it('should register a new user as an employee without returning a token', async () => {
      const res = await request(app).post('/auth/register').send({
        company_id: companyId,
        email: testEmail,
        password: testPassword,
        full_name: 'Test New Employee'
      });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.user.role).toBe('employee'); // Always employee
      expect(res.body.user.password).toBeUndefined(); // Never expose hash
      expect(res.body.token).toBeUndefined(); // Register does not return token
    });

    it('should reject registration if email is already taken', async () => {
      const res = await request(app).post('/auth/register').send({
        company_id: companyId,
        email: testEmail,
        password: 'AnotherPassword!',
        full_name: 'Duplicate User'
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });
  });

  describe('POST /auth/login', () => {
    it('should reject invalid credentials', async () => {
      const res = await request(app).post('/auth/login').send({
        email: testEmail,
        password: 'WrongPassword'
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid email or password/i);
    });

    it('should login successfully with correct credentials and return a token', async () => {
      const res = await request(app).post('/auth/login').send({
        email: testEmail,
        password: testPassword
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.user.role).toBe('employee');
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toMatch(/token=/);
    });
  });

  describe('POST /auth/forgot-password & POST /auth/reset-password', () => {
    it('should return 200 with generic message for non-existent email to prevent user enumeration', async () => {
      const res = await request(app).post('/auth/forgot-password').send({
        email: 'unknown_ghost_email_999@deliverback.com'
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/if an account exists/i);
    });

    it('should generate a reset token, log the link to console, and store the SHA-256 hash in DB', async () => {
      let capturedToken = '';
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
        for (const arg of args) {
          if (typeof arg === 'string' && arg.startsWith('Token: ')) {
            capturedToken = arg.replace('Token: ', '').trim();
          }
        }
      });

      const res = await request(app).post('/auth/forgot-password').send({
        email: testEmail
      });

      consoleSpy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/if an account exists/i);
      expect(capturedToken).toBeTruthy();
      resetToken = capturedToken;

      // Verify SHA-256 hash was saved in database, NOT raw token
      const userRes = await pool.query(
        'SELECT reset_token FROM users WHERE email = $1',
        [testEmail.toLowerCase()]
      );
      const expectedHash = crypto.createHash('sha256').update(capturedToken).digest('hex');
      expect(userRes.rows[0].reset_token).toBe(expectedHash);
    });

    it('should reject password reset with an invalid token', async () => {
      const res = await request(app).post('/auth/reset-password').send({
        token: 'invalid-non-existent-token',
        new_password: 'BrandNewPassword123!'
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid or expired reset token/i);
    });

    it('should successfully reset password with valid token', async () => {
      const newPassword = 'BrandNewPassword123!';
      const res = await request(app).post('/auth/reset-password').send({
        token: resetToken,
        new_password: newPassword
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/successfully/i);

      // Verify can now login with the new password
      const loginRes = await request(app).post('/auth/login').send({
        email: testEmail,
        password: newPassword
      });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();
    });
  });
});

