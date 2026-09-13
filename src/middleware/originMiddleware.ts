import { Request, Response, NextFunction } from 'express';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const allowedOrigins: string[] = [
  CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://longevix.com',
  'https://longevix6.com',
  'https://www.longevix.com',
];

/**
 * Validate Origin header for state-changing admin routes (CSRF protection)
 */
export function validateAdminOrigin(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  const stateChangingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (!stateChangingMethods.includes(method)) {
    return next();
  }

  const originHeader = req.headers['origin'];

  // If origin is null (e.g. data: URLs, sandboxed iframes, privacy extensions), reject
  if (originHeader === 'null') {
    res.status(403).json({
      success: false,
      message: 'CSRF check failed: opaque or null origin is forbidden.',
    });
    return;
  }

  if (originHeader) {
    const isAllowed =
      allowedOrigins.includes(originHeader) ||
      originHeader.includes('vercel.app') ||
      originHeader.includes('onrender.com') ||
      (process.env.NODE_ENV !== 'production' &&
        (originHeader.startsWith('http://localhost:') || originHeader.startsWith('http://127.0.0.1:')));

    if (!isAllowed) {
      res.status(403).json({
        success: false,
        message: 'CSRF check failed: unauthorized request origin.',
      });
      return;
    }
  }

  next();
}
