import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, AuthUserPayload, UserRole } from '../types';
import { JWT_SECRET } from '../config/jwt';

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const token =
    req.cookies?.token ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) ||
    (typeof req.query?.token === 'string' ? req.query.token : null);

  if (!token) {
    res.status(401).json({ error: 'Authentication required. No token cookie provided.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUserPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function requireRole(role: UserRole) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (req.user.role !== role) {
      res.status(403).json({ error: `Forbidden: Only ${role}s can perform this action.` });
      return;
    }

    next();
  };
}
