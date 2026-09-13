import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import pool from '../config/db';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

const JWT_SECRET = process.env.JWT_SECRET || 'longevix6_default_jwt_secret_fallback_do_not_use_in_prod';
const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(255),
});

/**
 * Standard generic error to prevent account enumeration
 */
const GENERIC_AUTH_ERROR = {
  success: false,
  message: 'Invalid email or password.',
};

/**
 * Admin Login Handler
 */
export async function adminLogin(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(401).json(GENERIC_AUTH_ERROR);
      return;
    }

    const { email, password } = parseResult.data;

    // 1. Query admin user by email
    const result = await pool.query(
      'SELECT id, email, password_hash, full_name, role, is_active FROM admin_users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      // Constant-time dummy hash compare to prevent timing enumeration
      await bcrypt.compare(password, '$2b$10$wN1vG6yYgQ2r8r.12345678901234567890123456789012345678');
      res.status(401).json(GENERIC_AUTH_ERROR);
      return;
    }

    const adminUser = result.rows[0];

    // 2. Active status verification
    if (!adminUser.is_active || adminUser.role !== 'admin') {
      await bcrypt.compare(password, adminUser.password_hash);
      res.status(401).json(GENERIC_AUTH_ERROR);
      return;
    }

    // 3. Password comparison
    const isPasswordValid = await bcrypt.compare(password, adminUser.password_hash);
    if (!isPasswordValid) {
      res.status(401).json(GENERIC_AUTH_ERROR);
      return;
    }

    // 4. Update last_login_at
    await pool.query('UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [
      adminUser.id,
    ]);

    // 5. Sign JWT (HS256, 8-hour expiry)
    const token = jwt.sign(
      {
        sub: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      },
      JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: '8h',
      }
    );

    // 6. Set secure HttpOnly cookie (NEVER return token in JSON)
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('longevix_admin_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: TOKEN_MAX_AGE_MS,
    });

    res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      data: {
        id: adminUser.id,
        email: adminUser.email,
        fullName: adminUser.full_name,
        role: adminUser.role,
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during authentication.',
    });
  }
}

/**
 * Admin Logout Handler
 */
export async function adminLogout(req: Request, res: Response): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('longevix_admin_token', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  });

  res.status(200).json({
    success: true,
    message: 'Successfully logged out.',
  });
}

/**
 * Admin Get Current Session Handler
 */
export async function adminGetMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.admin) {
    res.status(401).json({
      success: false,
      message: 'Not authenticated.',
    });
    return;
  }

  res.status(200).json({
    success: true,
    data: req.admin,
  });
}
