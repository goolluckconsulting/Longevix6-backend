import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db';

export interface AdminPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  admin?: {
    id: string;
    email: string;
    fullName: string;
    role: string;
  };
}

const JWT_SECRET = process.env.JWT_SECRET || 'longevix6_default_jwt_secret_fallback_do_not_use_in_prod';

/**
 * Middleware to verify admin authentication via secure HttpOnly cookie
 */
export async function requireAdminAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.longevix_admin_token;

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
      });
      return;
    }

    // 1. Verify JWT signature, algorithm, and expiration
    let decoded: AdminPayload;
    try {
      decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AdminPayload;
    } catch (err: any) {
      res.status(401).json({
        success: false,
        message: 'Session expired or invalid. Please log in again.',
      });
      return;
    }

    // 2. Query database for active admin user verification
    const userResult = await pool.query(
      'SELECT id, email, full_name, role, is_active FROM admin_users WHERE id = $1',
      [decoded.sub]
    );

    if (userResult.rows.length === 0) {
      res.status(401).json({
        success: false,
        message: 'Invalid administrative session.',
      });
      return;
    }

    const adminUser = userResult.rows[0];

    // 3. Active check
    if (!adminUser.is_active) {
      res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact system administrator.',
      });
      return;
    }

    // 4. Role check
    if (adminUser.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Insufficient privileges. Admin access required.',
      });
      return;
    }

    // 5. Attach admin user to request
    req.admin = {
      id: adminUser.id,
      email: adminUser.email,
      fullName: adminUser.full_name,
      role: adminUser.role,
    };

    next();
  } catch (error) {
    console.error('requireAdminAuth unexpected error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
    });
  }
}
