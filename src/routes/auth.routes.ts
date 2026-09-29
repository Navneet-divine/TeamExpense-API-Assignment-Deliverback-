import { Router } from 'express';
import {
  register,
  login,
  forgotPassword,
  resetPassword
} from '../controllers/auth.controller';

const router = Router();

// 1. POST /auth/register: creates a user in an existing company. New users are always employees.
router.post('/register', register);

// 2. POST /auth/login: returns a token (and sets cookie).
router.post('/login', login);

// 3. POST /auth/forgot-password: accepts an email and generates a reset token (logs reset link to console).
router.post('/forgot-password', forgotPassword);

// 4. POST /auth/reset-password: accepts the token and a new password.
router.post('/reset-password', resetPassword);

export default router;
