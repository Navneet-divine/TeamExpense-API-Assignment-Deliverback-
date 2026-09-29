import request from 'supertest';
import path from 'path';
import fs from 'fs';
import app from '../src/app';
import { pool } from '../src/config/db';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Feature 4: Receipts Endpoints', () => {
  let employeeCookie: string;
  let managerCookie: string;
  let coworkerCookie: string;
  let otherCompanyCookie: string;
  let expenseId: number;
  let uploadedFilename = '';
  const dummyFilePath = path.join(__dirname, 'dummy_receipt.png');

  beforeAll(async () => {
    // Create a 1x1 dummy PNG buffer for testing uploads
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89
    ]);
    fs.writeFileSync(dummyFilePath, pngHeader);

    // Alice login (employee - Company 1)
    const loginRes = await request(app).post('/auth/login').send({
      email: 'alice@deliverback.com',
      password: 'Password123!'
    });
    employeeCookie = loginRes.headers['set-cookie'][0];

    // George login (manager - Company 1)
    const managerLogin = await request(app).post('/auth/login').send({
      email: 'george@deliverback.com',
      password: 'Password123!'
    });
    managerCookie = managerLogin.headers['set-cookie'][0];

    // Bob login (different employee - Company 1)
    const bobLogin = await request(app).post('/auth/login').send({
      email: 'bob@deliverback.com',
      password: 'Password123!'
    });
    coworkerCookie = bobLogin.headers['set-cookie'][0];

    // Lucas login (manager - Company 2)
    const otherLogin = await request(app).post('/auth/login').send({
      email: 'lucas@loopcv.com',
      password: 'Password123!'
    });
    otherCompanyCookie = otherLogin.headers['set-cookie'][0];

    // Find Alice's pending expense
    const res = await pool.query(
      `SELECT e.id FROM expenses e 
       JOIN users u ON e.user_id = u.id 
       WHERE u.email = 'alice@deliverback.com' AND e.status = 'pending' LIMIT 1`
    );
    expenseId = res.rows[0].id;
  });

  afterAll(async () => {
    // Clean dummy test files
    if (fs.existsSync(dummyFilePath)) {
      fs.unlinkSync(dummyFilePath);
    }
    if (uploadedFilename) {
      const uploadedPath = path.join(process.cwd(), 'uploads', uploadedFilename);
      if (fs.existsSync(uploadedPath)) {
        fs.unlinkSync(uploadedPath);
      }
    }
    await pool.end();
  });

  describe('POST /expenses/:id/receipt (file upload)', () => {
    it('should reject unauthenticated upload', async () => {
      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt`)
        .attach('receipt', dummyFilePath);

      expect(res.status).toBe(401);
    });

    it('should upload a receipt file and attach to expense', async () => {
      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt`)
        .set('Cookie', [employeeCookie])
        .attach('receipt', dummyFilePath);

      expect(res.status).toBe(200);
      expect(res.body.receipt_file).toBeDefined();
      expect(res.body.expense.receipt_file).toBe(res.body.receipt_file);

      uploadedFilename = res.body.receipt_file;

      // Verify file exists on disk
      const filePath = path.join(process.cwd(), 'uploads', uploadedFilename);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should reject file upload with disallowed extension', async () => {
      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt`)
        .set('Cookie', [employeeCookie])
        .attach('receipt', Buffer.from('echo "malicious"'), 'script.sh');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid file type/i);
    });
  });

  describe('GET /receipts/:filename (download receipt)', () => {
    it('should reject unauthenticated receipt download with 401', async () => {
      const res = await request(app).get(`/receipts/${uploadedFilename}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/authentication required/i);
    });

    it('should reject cross-company receipt download with 404', async () => {
      const res = await request(app)
        .get(`/receipts/${uploadedFilename}`)
        .set('Cookie', [otherCompanyCookie]);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('should forbid other employees from downloading receipt with 403', async () => {
      const res = await request(app)
        .get(`/receipts/${uploadedFilename}`)
        .set('Cookie', [coworkerCookie]);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/only view receipts for your own expenses/i);
    });

    it('should allow submitting employee to download their own receipt', async () => {
      const res = await request(app)
        .get(`/receipts/${uploadedFilename}`)
        .set('Cookie', [employeeCookie]);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/attachment/i);
    });

    it('should allow company manager to download company employee receipt', async () => {
      const res = await request(app)
        .get(`/receipts/${uploadedFilename}`)
        .set('Cookie', [managerCookie]);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/attachment/i);
    });

    it('should return 404 for non-existent receipt when authenticated', async () => {
      const res = await request(app)
        .get('/receipts/non-existent-receipt-999.png')
        .set('Cookie', [employeeCookie]);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('POST /expenses/:id/receipt-from-url (remote download)', () => {
    it('should download a receipt from URL and attach to expense', async () => {
      const testBuffer = Buffer.from('mock pdf content');
      mockedAxios.get.mockResolvedValueOnce({
        data: testBuffer,
        headers: { 'content-type': 'application/pdf' }
      } as any);

      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt-from-url`)
        .set('Cookie', [employeeCookie])
        .send({ url: 'https://example.com/storage/invoice_123.pdf' });

      expect(res.status).toBe(200);
      expect(res.body.receipt_file).toBeDefined();
      expect(res.body.receipt_file).toMatch(/\.pdf$/);

      // Clean up the created mock file from disk
      const createdPdf = path.join(process.cwd(), 'uploads', res.body.receipt_file);
      if (fs.existsSync(createdPdf)) {
        fs.unlinkSync(createdPdf);
      }
    });

    it('should reject invalid or unsupported mime types from URL', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: Buffer.from('plain text'),
        headers: { 'content-type': 'text/plain' }
      } as any);

      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt-from-url`)
        .set('Cookie', [employeeCookie])
        .send({ url: 'https://example.com/receipt.txt' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not supported/i);
    });

    it('should reject SSRF attempts to localhost', async () => {
      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt-from-url`)
        .set('Cookie', [employeeCookie])
        .send({ url: 'http://localhost:5001/api/expenses' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/blocked for security|internal/i);
    });

    it('should reject SSRF attempts to 127.0.0.1 (loopback IP)', async () => {
      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt-from-url`)
        .set('Cookie', [employeeCookie])
        .send({ url: 'http://127.0.0.1:8080/secret.pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/blocked for security|private/i);
    });

    it('should reject SSRF attempts to AWS/cloud metadata IP (169.254.169.254)', async () => {
      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt-from-url`)
        .set('Cookie', [employeeCookie])
        .send({ url: 'http://169.254.169.254/latest/meta-data/' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/blocked for security|private/i);
    });

    it('should reject SSRF attempts to private network addresses (192.168.x.x)', async () => {
      const res = await request(app)
        .post(`/expenses/${expenseId}/receipt-from-url`)
        .set('Cookie', [employeeCookie])
        .send({ url: 'http://192.168.1.1/internal.pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/blocked for security|private/i);
    });
  });
});
