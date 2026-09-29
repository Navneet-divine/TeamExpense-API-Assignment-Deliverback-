import dotenv from 'dotenv';

dotenv.config();

const rawJwtSecret = process.env.JWT_SECRET;

// In production, reject startup if JWT_SECRET is unset or too weak
if (process.env.NODE_ENV === 'production' && (!rawJwtSecret || rawJwtSecret.trim().length < 32)) {
  throw new Error(
    'FATAL SECURITY CONFIGURATION ERROR: JWT_SECRET environment variable must be defined and at least 32 characters long in production.'
  );
}

// Export centralized secret with fallback for test and development
export const JWT_SECRET: string = rawJwtSecret || 'super_secret_jwt_key_teamexpense_2026';
