import { Request } from 'express';

export type UserRole = 'employee' | 'manager';
export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface Company {
  id: number;
  name: string;
  created_at: Date;
}

export interface User {
  id: number;
  company_id: number;
  email: string;
  password?: string;
  full_name: string;
  role: UserRole;
  total_reimbursed: string | number;
  reset_token?: string | null;
  reset_token_expires_at?: Date | null;
  created_at: Date;
}

export interface Expense {
  id: number;
  company_id: number;
  user_id: number;
  title: string;
  amount: string | number;
  currency: string;
  category: string;
  status: ExpenseStatus;
  receipt_file?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Comment {
  id: number;
  expense_id: number;
  user_id: number;
  text: string;
  created_at: Date;
  author_name?: string;
  author_role?: UserRole;
}

export interface AuthUserPayload {
  userId: number;
  companyId: number;
  email: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: AuthUserPayload;
}
