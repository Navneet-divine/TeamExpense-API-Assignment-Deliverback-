import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import { AuthRequest } from '../types';
import { query } from '../config/db';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Helper to map content-type to file extension
function getExtensionFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'application/pdf':
      return '.pdf';
    default:
      return '';
  }
}

// 1. POST /expenses/:id/receipt: upload a receipt file (image or PDF)
export async function uploadReceipt(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) {
      res.status(400).json({ error: 'Invalid expense ID.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No receipt file provided. Please attach an image or PDF.' });
      return;
    }

    // Check expense existence and scoping
    const expenseRes = await query('SELECT * FROM expenses WHERE id = $1', [expenseId]);
    if (expenseRes.rowCount === 0) {
      // Remove uploaded file if expense not found
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    const expense = expenseRes.rows[0];

    // Company isolation
    if (expense.company_id !== user.companyId) {
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    // Employee ownership check
    if (user.role === 'employee' && expense.user_id !== user.userId) {
      fs.unlinkSync(req.file.path);
      res.status(403).json({ error: 'Forbidden: You can only upload receipts for your own expenses.' });
      return;
    }

    const filename = req.file.filename;

    const result = await query(
      `UPDATE expenses
       SET receipt_file = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [filename, expenseId]
    );

    res.status(200).json({
      message: 'Receipt uploaded successfully.',
      receipt_file: filename,
      expense: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error uploading receipt:', error);
    res.status(500).json({ error: 'Internal server error while uploading receipt.' });
  }
}

// 2. POST /expenses/:id/receipt-from-url: download receipt from external URL
export async function uploadReceiptFromUrl(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) {
      res.status(400).json({ error: 'Invalid expense ID.' });
      return;
    }

    const { url } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      res.status(400).json({ error: 'A valid http/https URL is required.' });
      return;
    }

    // Check expense
    const expenseRes = await query('SELECT * FROM expenses WHERE id = $1', [expenseId]);
    if (expenseRes.rowCount === 0) {
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    const expense = expenseRes.rows[0];

    // Multi-tenant check
    if (expense.company_id !== user.companyId) {
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }

    if (user.role === 'employee' && expense.user_id !== user.userId) {
      res.status(403).json({ error: 'Forbidden: You can only attach receipts to your own expenses.' });
      return;
    }

    // Download file from URL
    let downloadResponse;
    try {
      downloadResponse = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 10 * 1024 * 1024 // 10MB
      });
    } catch (fetchError: any) {
      res.status(400).json({ error: `Failed to download receipt from the provided URL: ${fetchError.message}` });
      return;
    }

    const rawContentType = downloadResponse.headers['content-type'];
    const contentType = (typeof rawContentType === 'string' ? rawContentType : '').split(';')[0]?.trim() || '';
    let ext = getExtensionFromMime(contentType);

    if (!ext) {
      const urlExt = path.extname(new URL(url).pathname).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'].includes(urlExt)) {
        ext = urlExt;
      }
    }

    if (!ext) {
      res.status(400).json({
        error: `Downloaded file type (${contentType || 'unknown'}) is not supported. Must be an image or PDF.`
      });
      return;
    }

    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const filename = `receipt-${uniqueSuffix}${ext}`;
    const targetPath = path.join(UPLOADS_DIR, filename);

    fs.writeFileSync(targetPath, Buffer.from(downloadResponse.data));

    const result = await query(
      `UPDATE expenses
       SET receipt_file = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [filename, expenseId]
    );

    res.status(200).json({
      message: 'Receipt downloaded and attached successfully.',
      receipt_file: filename,
      expense: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error downloading receipt from URL:', error);
    res.status(500).json({ error: 'Internal server error while fetching receipt from URL.' });
  }
}

// 3. GET /receipts/:filename: download a receipt file
export async function downloadReceipt(req: Request, res: Response): Promise<void> {
  try {
    const rawFilename = req.params.filename;

    // Guard against path traversal attacks (e.g. ../../etc/passwd)
    const sanitizedFilename = path.basename(rawFilename);
    const filePath = path.join(UPLOADS_DIR, sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Receipt file not found.' });
      return;
    }

    res.download(filePath, sanitizedFilename);
  } catch (error: any) {
    console.error('Error downloading receipt file:', error);
    res.status(500).json({ error: 'Internal server error while downloading receipt.' });
  }
}
