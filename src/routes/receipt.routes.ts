import { Router } from 'express';
import {
  uploadReceipt,
  uploadReceiptFromUrl,
  downloadReceipt
} from '../controllers/receipt.controller';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { urlDownloadLimiter } from '../middleware/rateLimiter';

const router = Router();

// 4. Receipts
// POST /expenses/:id/receipt: upload a receipt file (image or PDF)
router.post('/expenses/:id/receipt', authenticate, upload.single('receipt'), uploadReceipt);

// POST /expenses/:id/receipt-from-url: download from remote URL
router.post('/expenses/:id/receipt-from-url', authenticate, urlDownloadLimiter, uploadReceiptFromUrl);

// GET /receipts/:filename: download a receipt file (authenticated & tenant scoped)
router.get('/receipts/:filename', authenticate, downloadReceipt);

export default router;
