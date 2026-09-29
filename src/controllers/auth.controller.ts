import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../config/db';
import { JWT_SECRET } from '../config/jwt';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const BASE_URL = process.env.BASE_URL || 'http://localhost:5001';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 24 * 60 * 60 * 1000 // 1 day
};

// POST /auth/register
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { company_id, email, password, full_name } = req.body;

    if (!company_id || !email || !password || !full_name) {
      res.status(400).json({
        error: 'Missing required fields: company_id, email, password, and full_name are required.'
      });
      return;
    }

    // Verify company exists
    const companyCheck = await query('SELECT id, name FROM companies WHERE id = $1', [company_id]);
    if (companyCheck.rowCount === 0) {
      res.status(404).json({ error: `Company with id ${company_id} does not exist.` });
      return;
    }

    // Check if email already registered
    const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existingUser.rowCount && existingUser.rowCount > 0) {
      res.status(409).json({ error: 'A user with this email already exists.' });
      return;
    }

    // New users are ALWAYS employees
    const role = 'employee';
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (company_id, email, password, full_name, role)
       VALUES ($1, LOWER($2), $3, $4, $5)
       RETURNING id, company_id, email, full_name, role, total_reimbursed, created_at`,
      [company_id, email, hashedPassword, full_name, role]
    );

    const newUser = result.rows[0];

    res.status(201).json({
      message: 'User registered successfully.',
      user: newUser
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
}

// POST /auth/login
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const result = await query(
      `SELECT id, company_id, email, password, full_name, role, total_reimbursed
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (result.rowCount === 0) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = jwt.sign(
      {
        userId: user.id,
        companyId: user.company_id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
    );

    // Set token in httpOnly cookie
    res.cookie('token', token, COOKIE_OPTIONS);

    delete user.password;

    res.status(200).json({
      message: 'Login successful.',
      token,
      user
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
}

// POST /auth/forgot-password
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }

    const userResult = await query(
      `SELECT id, email, full_name FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    // Uniform response to prevent user enumeration attacks
    const genericSuccessMessage =
      'If an account exists with this email address, a password reset link has been generated.';

    if (userResult.rowCount === 0) {
      res.status(200).json({ message: genericSuccessMessage });
      return;
    }

    const user = userResult.rows[0];
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    // Store SHA-256 hash of token in the database to protect against DB leaks
    const hashedToken = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `UPDATE users
       SET reset_token = $1, reset_token_expires_at = $2
       WHERE id = $3`,
      [hashedToken, expiresAt, user.id]
    );

    const resetLink = `${BASE_URL}/auth/reset-password?token=${rawResetToken}`;
    console.log('====================================================');
    console.log(`🔐 [PASSWORD RESET LINK for ${user.email}]:`);
    console.log(`🔗 ${resetLink}`);
    console.log(`Token: ${rawResetToken}`);
    console.log('====================================================');

    res.status(200).json({
      message: genericSuccessMessage
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error during password reset request.' });
  }
}

// POST /auth/reset-password
export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { token, new_password, password } = req.body;
    const finalPassword = new_password || password;

    if (!token || !finalPassword) {
      res.status(400).json({ error: 'Reset token and new password are required.' });
      return;
    }

    if (finalPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      return;
    }

    // Hash incoming token using SHA-256 to compare against the hashed token in DB
    const hashedToken = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const result = await query(
      `SELECT id, email, reset_token_expires_at
       FROM users
       WHERE reset_token = $1`,
      [hashedToken]
    );

    if (result.rowCount === 0) {
      res.status(400).json({ error: 'Invalid or expired reset token.' });
      return;
    }

    const user = result.rows[0];
    const now = new Date();

    if (new Date(user.reset_token_expires_at) < now) {
      res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    await query(
      `UPDATE users
       SET password = $1, reset_token = NULL, reset_token_expires_at = NULL
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    res.status(200).json({ message: 'Password has been reset successfully. You can now login.' });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error during password reset.' });
  }
}
