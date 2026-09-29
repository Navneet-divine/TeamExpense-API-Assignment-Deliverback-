import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../types';
import { query } from '../config/db';

// 1. GET /me: returns the current user's profile
export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const result = await query(
      `SELECT u.id, u.company_id, c.name AS company_name, u.email, u.full_name, u.role, u.total_reimbursed, u.created_at
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
      [userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.status(200).json({ user: result.rows[0] });
  } catch (error: any) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Internal server error while fetching profile.' });
  }
}

// 2. PATCH /me: lets users update their own profile. Update only fields that make sense.
export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const { full_name, email, old_password, new_password } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Allowed updatable field: full_name
    if (full_name !== undefined) {
      if (typeof full_name !== 'string' || full_name.trim().length === 0) {
        res.status(400).json({ error: 'full_name must be a non-empty string.' });
        return;
      }
      updates.push(`full_name = $${paramIndex++}`);
      values.push(full_name.trim());
    }

    // Allowed updatable field: email
    if (email !== undefined) {
      if (typeof email !== 'string' || !email.includes('@')) {
        res.status(400).json({ error: 'Invalid email address.' });
        return;
      }

      // Check if email taken by another user
      const emailCheck = await query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2`,
        [email, userId]
      );
      if (emailCheck.rowCount && emailCheck.rowCount > 0) {
        res.status(409).json({ error: 'This email is already in use by another account.' });
        return;
      }

      updates.push(`email = LOWER($${paramIndex++})`);
      values.push(email.trim());
    }

    // Allowed updatable field: new_password (requires verifying old_password first)
    if (new_password !== undefined) {
      if (!old_password) {
        res.status(400).json({
          error: 'old_password is required to set a new password.'
        });
        return;
      }

      if (typeof new_password !== 'string' || new_password.length < 6) {
        res.status(400).json({ error: 'new_password must be at least 6 characters long.' });
        return;
      }

      // Retrieve current hashed password
      const userRes = await query('SELECT password FROM users WHERE id = $1', [userId]);
      if (userRes.rowCount === 0) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const isOldPasswordCorrect = await bcrypt.compare(old_password, userRes.rows[0].password);
      if (!isOldPasswordCorrect) {
        res.status(400).json({ error: 'Incorrect old password.' });
        return;
      }

      const hashedPassword = await bcrypt.hash(new_password, 10);
      updates.push(`password = $${paramIndex++}`);
      values.push(hashedPassword);
    }

    // If no valid updatable fields were sent (e.g. only sent role, company_id, total_reimbursed)
    if (updates.length === 0) {
      res.status(400).json({
        error: 'No valid fields provided for update. Only full_name, email, and password can be updated.'
      });
      return;
    }

    // Append userId as the last parameter
    values.push(userId);
    const sql = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, company_id, email, full_name, role, total_reimbursed, created_at
    `;

    const result = await query(sql, values);

    // Fetch company name for complete profile representation
    const companyRes = await query('SELECT name FROM companies WHERE id = $1', [result.rows[0].company_id]);
    const updatedUser = {
      ...result.rows[0],
      company_name: companyRes.rows[0]?.name
    };

    res.status(200).json({
      message: 'Profile updated successfully.',
      user: updatedUser
    });
  } catch (error: any) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Internal server error while updating profile.' });
  }
}
