import { Request, Response } from 'express';
import { z } from 'zod';
import pool from '../config/db';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const createBlogSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z
    .string()
    .max(255)
    .regex(slugRegex, 'Slug must contain only lowercase alphanumeric characters and hyphens')
    .optional(),
  excerpt: z.string().min(1).max(500),
  content: z.string().min(1).max(100000),
  featured_image: z.string().optional().nullable(),
  author_name: z.string().max(100).default('Dr. Ankitaa Gupta'),
  author_role: z.string().max(100).default('Founder & Medical Director'),
  author_avatar: z.string().optional().nullable(),
  category: z.string().max(100).default('Longevity'),
  read_time_minutes: z.coerce.number().int().min(1).max(120).default(5),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  meta_title: z.string().max(255).optional().nullable(),
  meta_description: z.string().max(500).optional().nullable(),
  canonical_url: z.string().optional().nullable(),
});

const updateBlogSchema = createBlogSchema.partial();

/**
 * GET /api/admin/blogs
 * Admin listing with status filter & pagination
 */
export async function adminGetBlogs(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = req.query.search as string;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status && status !== 'all' && ['draft', 'published', 'archived'].includes(status)) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (search && search.trim() !== '') {
      conditions.push(
        `(LOWER(title) LIKE LOWER($${paramIndex}) OR LOWER(excerpt) LIKE LOWER($${paramIndex}))`
      );
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM blogs ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(
      `SELECT 
        id, title, slug, excerpt, featured_image, 
        author_name, author_role, author_avatar, 
        category, read_time_minutes, status, published_at, 
        created_at, updated_at
       FROM blogs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataParams
    );

    res.status(200).json({
      success: true,
      data: dataResult.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error in adminGetBlogs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve blogs.',
    });
  }
}

/**
 * GET /api/admin/blogs/:id
 * Retrieve a specific blog by UUID for editing
 */
export async function adminGetBlogById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id || !uuidRegex.test(id)) {
      res.status(400).json({
        success: false,
        message: 'Invalid blog ID format (UUID required).',
      });
      return;
    }

    const result = await pool.query('SELECT * FROM blogs WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Blog post not found.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error in adminGetBlogById:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve blog post.',
    });
  }
}

/**
 * POST /api/admin/blogs
 * Create a new blog post
 */
export async function adminCreateBlog(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = createBlogSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: parseResult.error.format(),
      });
      return;
    }

    const data = parseResult.data;
    const finalSlug = data.slug || generateSlug(data.title);

    if (!finalSlug || !slugRegex.test(finalSlug)) {
      res.status(400).json({
        success: false,
        message: 'Invalid slug generated. Please provide a valid slug.',
      });
      return;
    }

    // 1. Check for slug collision
    const slugCheck = await pool.query('SELECT id FROM blogs WHERE slug = $1', [finalSlug]);
    if (slugCheck.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: 'A blog post with this slug already exists.',
      });
      return;
    }

    // 2. Determine published_at
    const publishedAt = data.status === 'published' ? new Date() : null;

    // 3. Insert record
    const insertResult = await pool.query(
      `INSERT INTO blogs (
        title, slug, excerpt, content, featured_image,
        author_name, author_role, author_avatar, category,
        read_time_minutes, status, published_at,
        meta_title, meta_description, canonical_url
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15
      ) RETURNING *`,
      [
        data.title,
        finalSlug,
        data.excerpt,
        data.content,
        data.featured_image || null,
        data.author_name || 'Dr. Ankitaa Gupta',
        data.author_role || 'Founder & Medical Director',
        data.author_avatar || '/dr_ankita_founder.webp',
        data.category || 'Longevity',
        data.read_time_minutes || 5,
        data.status || 'draft',
        publishedAt,
        data.meta_title || null,
        data.meta_description || null,
        data.canonical_url || null,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Blog post created successfully.',
      data: insertResult.rows[0],
    });
  } catch (error: any) {
    console.error('Error in adminCreateBlog:', error);
    if (error.code === '23505') {
      res.status(409).json({
        success: false,
        message: 'A blog post with this slug already exists.',
      });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create blog post.',
    });
  }
}

/**
 * PUT /api/admin/blogs/:id
 * Update an existing blog post
 */
export async function adminUpdateBlog(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id || !uuidRegex.test(id)) {
      res.status(400).json({
        success: false,
        message: 'Invalid blog ID format (UUID required).',
      });
      return;
    }

    const parseResult = updateBlogSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: parseResult.error.format(),
      });
      return;
    }

    // 1. Fetch current blog state
    const currentResult = await pool.query('SELECT * FROM blogs WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Blog post not found.',
      });
      return;
    }

    const currentBlog = currentResult.rows[0];
    const data = parseResult.data;

    // 2. Slug validation and collision check
    let finalSlug = currentBlog.slug;
    if (data.slug && data.slug !== currentBlog.slug) {
      if (!slugRegex.test(data.slug)) {
        res.status(400).json({
          success: false,
          message: 'Invalid slug format.',
        });
        return;
      }
      const slugCheck = await pool.query('SELECT id FROM blogs WHERE slug = $1 AND id != $2', [
        data.slug,
        id,
      ]);
      if (slugCheck.rows.length > 0) {
        res.status(409).json({
          success: false,
          message: 'A blog post with this slug already exists.',
        });
        return;
      }
      finalSlug = data.slug;
    }

    // 3. published_at handling according to Section 9.5
    let publishedAt = currentBlog.published_at;
    const targetStatus = data.status || currentBlog.status;

    if (targetStatus === 'published') {
      if (!publishedAt) {
        publishedAt = new Date();
      }
      // If already published, preserve original published_at
    }

    // 4. Update in database
    const updateResult = await pool.query(
      `UPDATE blogs SET
        title = COALESCE($1, title),
        slug = $2,
        excerpt = COALESCE($3, excerpt),
        content = COALESCE($4, content),
        featured_image = COALESCE($5, featured_image),
        author_name = COALESCE($6, author_name),
        author_role = COALESCE($7, author_role),
        author_avatar = COALESCE($8, author_avatar),
        category = COALESCE($9, category),
        read_time_minutes = COALESCE($10, read_time_minutes),
        status = $11,
        published_at = $12,
        meta_title = COALESCE($13, meta_title),
        meta_description = COALESCE($14, meta_description),
        canonical_url = COALESCE($15, canonical_url),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $16
      RETURNING *`,
      [
        data.title,
        finalSlug,
        data.excerpt,
        data.content,
        data.featured_image !== undefined ? data.featured_image : currentBlog.featured_image,
        data.author_name,
        data.author_role,
        data.author_avatar !== undefined ? data.author_avatar : currentBlog.author_avatar,
        data.category,
        data.read_time_minutes,
        targetStatus,
        publishedAt,
        data.meta_title !== undefined ? data.meta_title : currentBlog.meta_title,
        data.meta_description !== undefined ? data.meta_description : currentBlog.meta_description,
        data.canonical_url !== undefined ? data.canonical_url : currentBlog.canonical_url,
        id,
      ]
    );

    res.status(200).json({
      success: true,
      message: 'Blog post updated successfully.',
      data: updateResult.rows[0],
    });
  } catch (error: any) {
    console.error('Error in adminUpdateBlog:', error);
    if (error.code === '23505') {
      res.status(409).json({
        success: false,
        message: 'A blog post with this slug already exists.',
      });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update blog post.',
    });
  }
}

/**
 * PATCH /api/admin/blogs/:id/status
 * Quick status transition (draft <-> published <-> archived)
 */
export async function adminUpdateBlogStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !uuidRegex.test(id)) {
      res.status(400).json({
        success: false,
        message: 'Invalid blog ID format (UUID required).',
      });
      return;
    }

    if (!status || !['draft', 'published', 'archived'].includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Invalid status. Must be draft, published, or archived.',
      });
      return;
    }

    // 1. Fetch current blog
    const currentResult = await pool.query('SELECT id, status, published_at FROM blogs WHERE id = $1', [
      id,
    ]);

    if (currentResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Blog post not found.',
      });
      return;
    }

    const current = currentResult.rows[0];
    let publishedAt = current.published_at;

    // Transition rules
    if (status === 'published' && !publishedAt) {
      publishedAt = new Date();
    }

    const updateResult = await pool.query(
      `UPDATE blogs SET
        status = $1,
        published_at = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, title, slug, status, published_at, updated_at`,
      [status, publishedAt, id]
    );

    res.status(200).json({
      success: true,
      message: `Blog status updated to ${status}.`,
      data: updateResult.rows[0],
    });
  } catch (error) {
    console.error('Error in adminUpdateBlogStatus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update blog status.',
    });
  }
}

/**
 * DELETE /api/admin/blogs/:id
 * Safe soft archive (per plan: no permanent deletion in MVP)
 */
export async function adminArchiveBlog(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id || !uuidRegex.test(id)) {
      res.status(400).json({
        success: false,
        message: 'Invalid blog ID format (UUID required).',
      });
      return;
    }

    const result = await pool.query(
      `UPDATE blogs SET
        status = 'archived',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title, slug, status`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Blog post not found.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Blog post archived successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error in adminArchiveBlog:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to archive blog post.',
    });
  }
}
