import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { adminLogin, adminLogout, adminGetMe } from '../controllers/adminAuthController';
import {
  adminGetBlogs,
  adminGetBlogById,
  adminCreateBlog,
  adminUpdateBlog,
  adminUpdateBlogStatus,
  adminArchiveBlog,
} from '../controllers/adminBlogController';
import { requireAdminAuth } from '../middleware/authMiddleware';
import { validateAdminOrigin } from '../middleware/originMiddleware';
import { upload, handleImageUpload } from '../middleware/uploadMiddleware';

const router = Router();

// 1. Rate Limiting for Admin Login (10 attempts per 15 minutes per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
  skipSuccessfulRequests: false,
});

// 2. Authentication Routes
router.post('/auth/login', loginLimiter, adminLogin);
router.post('/auth/logout', requireAdminAuth, adminLogout);
router.get('/auth/me', requireAdminAuth, adminGetMe);

// 3. Blog Management Routes (All require requireAdminAuth; state-changing routes require validateAdminOrigin)
router.get('/blogs', requireAdminAuth, adminGetBlogs);
router.get('/blogs/:id', requireAdminAuth, adminGetBlogById);
router.post('/blogs', requireAdminAuth, validateAdminOrigin, adminCreateBlog);
router.put('/blogs/:id', requireAdminAuth, validateAdminOrigin, adminUpdateBlog);
router.patch('/blogs/:id/status', requireAdminAuth, validateAdminOrigin, adminUpdateBlogStatus);
router.delete('/blogs/:id', requireAdminAuth, validateAdminOrigin, adminArchiveBlog);

// 4. Secure Image Upload (Authenticated Admin Only + Origin Validated + Multer 5MB memory storage)
router.post(
  '/upload',
  requireAdminAuth,
  validateAdminOrigin,
  (req, res, next) => {
    upload.single('image')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'Image size exceeds maximum limit of 5MB.',
          });
        }
        if (err.message === 'INVALID_MIME_TYPE') {
          return res.status(400).json({
            success: false,
            message: 'Invalid image format. Allowed formats: JPEG, PNG, WebP, AVIF.',
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error.',
        });
      }
      next();
    });
  },
  handleImageUpload
);

export default router;
