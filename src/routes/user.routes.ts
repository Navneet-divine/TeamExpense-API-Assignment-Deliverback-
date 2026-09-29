import { Router } from 'express';
import { getProfile, updateProfile } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// 2. Profile routes
// GET /me: returns the current user's profile
router.get('/me', authenticate, getProfile);

// PATCH /me: lets users update their own profile
router.patch('/me', authenticate, updateProfile);

export default router;
