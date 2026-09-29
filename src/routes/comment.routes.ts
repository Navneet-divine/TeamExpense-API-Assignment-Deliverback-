import { Router } from 'express';
import { addComment, renderExpenseView } from '../controllers/comment.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// 6. Comments
// POST /expenses/:id/comments: add a comment (authenticated)
router.post('/expenses/:id/comments', authenticate, addComment);

// GET /expenses/:id/view: server-rendered HTML page showing expense details and comments
router.get('/expenses/:id/view', renderExpenseView);

export default router;
