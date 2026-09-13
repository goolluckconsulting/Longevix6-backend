import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, S3ClientConfig } from '@aws-sdk/client-s3';

// 1. Allowed MIME types and extensions mapping
const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

// 2. Multer configured with memory storage & 5MB limit
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!MIME_EXT_MAP[file.mimetype]) {
      return cb(new Error('INVALID_MIME_TYPE'));
    }
    cb(null, true);
  },
});

/**
 * Validate binary magic bytes to prevent MIME spoofing
 */
export function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (!buffer || buffer.length < 12) return false;

  // JPEG: FF D8 FF
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  // PNG: 89 50 4E 47
  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }

  // WebP: RIFF header with WEBP format marker
  if (mimeType === 'image/webp') {
    const isRiff =
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46; // 'RIFF'
    const isWebp =
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50; // 'WEBP'
    return isRiff && isWebp;
  }

  // AVIF: ISO Base Media File Format containing 'ftyp' at bytes 4-7
  if (mimeType === 'image/avif') {
    return (
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70 // 'ftyp'
    );
  }

  return false;
}

// 3. AWS S3 Client setup for production
const region = process.env.AWS_REGION || 'ap-south-1';
const bucket = process.env.AWS_S3_BUCKET || 'longevix6-blog-assets';

const s3Config: S3ClientConfig = { region };
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3Config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}
const s3Client = new S3Client(s3Config);

/**
 * Handle image upload processing (Validation + Local / S3 Persistence)
 */
export async function handleImageUpload(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file;

    if (!file) {
      res.status(400).json({
        success: false,
        message: 'No image file uploaded or file rejected.',
      });
      return;
    }

    // 1. Verify MIME in whitelist
    const ext = MIME_EXT_MAP[file.mimetype];
    if (!ext) {
      res.status(400).json({
        success: false,
        message: 'Unsupported image type. Only JPEG, PNG, WebP, and AVIF are permitted.',
      });
      return;
    }

    // 2. Binary magic-byte validation
    const isValidBinary = validateMagicBytes(file.buffer, file.mimetype);
    if (!isValidBinary) {
      res.status(400).json({
        success: false,
        message: 'File content does not match reported image format (magic-byte check failed).',
      });
      return;
    }

    // 3. Generate secure, collision-resistant UUID filename
    const uuid = crypto.randomUUID();
    const filename = `${uuid}.${ext}`;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      // PRODUCTION: Must strictly upload to AWS S3 (Rule 10: Never fallback to local disk in prod)
      const objectKey = `blogs/${filename}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
      );

      const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;

      res.status(200).json({
        success: true,
        url: s3Url,
        data: { url: s3Url },
      });
      return;
    } else {
      // DEVELOPMENT: Local filesystem storage
      const uploadDir = path.join(process.cwd(), 'uploads', 'blogs');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, filename);
      fs.writeFileSync(filePath, file.buffer);

      const host = req.get('host') || `localhost:${process.env.PORT || 5000}`;
      const protocol = req.protocol || 'http';
      const localUrl = `${protocol}://${host}/uploads/blogs/${filename}`;

      res.status(200).json({
        success: true,
        url: localUrl,
        data: { url: localUrl },
      });
      return;
    }
  } catch (error: any) {
    console.error('Image upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Image upload failed.',
    });
  }
}
