import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for sensitive authentication endpoints (login, forgot-password, reset-password).
 * Protects against brute-force attacks and credential stuffing.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP. Please try again after 15 minutes.'
  },
  skip: () => process.env.NODE_ENV === 'test'
});

/**
 * Rate limiter for external URL fetching to prevent SSRF flooding and resource exhaustion.
 */
export const urlDownloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 download attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many receipt download requests from this IP. Please try again after 15 minutes.'
  },
  skip: () => process.env.NODE_ENV === 'test'
});
