import { Request, Response } from 'express';
import { z } from 'zod';
import pool from '../config/db';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const publicBlogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(30).default(10),
  category: z.string().max(100).optional(),
  search: z.string().max(100).optional(),
});

/**
 * GET /api/blogs/categories/list
 * Returns list of distinct categories with counts for published blogs
 */
export async function getCategories(req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT category, COUNT(*)::int AS count
      FROM blogs
      WHERE status = 'published'
        AND published_at IS NOT NULL
        AND published_at <= CURRENT_TIMESTAMP
      GROUP BY category
      ORDER BY count DESC, category ASC
    `);

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching blog categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve categories.',
    });
  }
}

/**
 * GET /api/blogs
 * Public listing of published blog posts (content column excluded for performance)
 */
export async function getBlogs(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = publicBlogQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: 'Invalid query parameters.',
        errors: parseResult.error.format(),
      });
      return;
    }

    const { page, limit, category, search } = parseResult.data;
    const offset = (page - 1) * limit;

    const conditions: string[] = [
      "status = 'published'",
      "published_at IS NOT NULL",
      "published_at <= CURRENT_TIMESTAMP",
    ];
    const params: any[] = [];
    let paramIndex = 1;

    if (category && category.trim() !== '' && category.toLowerCase() !== 'all') {
      conditions.push(`LOWER(category) = LOWER($${paramIndex})`);
      params.push(category.trim());
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

    // Total Count Query
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM blogs ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Data Query
    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(
      `SELECT 
        id, title, slug, excerpt, featured_image, 
        author_name, author_role, author_avatar, 
        category, read_time_minutes, published_at, created_at
       FROM blogs
       ${whereClause}
       ORDER BY published_at DESC, created_at DESC
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
    console.error('Error fetching blogs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve blog posts.',
    });
  }
}

/**
 * GET /api/blogs/:slug
 * Retrieve full published blog post by slug with related posts
 */
export async function getBlogBySlug(req: Request, res: Response): Promise<void> {
  try {
    const { slug } = req.params;

    if (!slug || !slugRegex.test(slug)) {
      res.status(400).json({
        success: false,
        message: 'Invalid slug format. Slug must contain only lowercase letters, numbers, and hyphens.',
      });
      return;
    }

    // 1. Fetch the primary blog post
    const result = await pool.query(
      `SELECT 
        id, title, slug, excerpt, content, featured_image, 
        author_name, author_role, author_avatar, 
        category, read_time_minutes, published_at, 
        meta_title, meta_description, canonical_url, 
        created_at, updated_at
       FROM blogs
       WHERE slug = $1
         AND status = 'published'
         AND published_at IS NOT NULL
         AND published_at <= CURRENT_TIMESTAMP`,
      [slug]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Blog post not found.',
      });
      return;
    }

    const blog = result.rows[0];

    // 2. Fetch up to 3 related posts in the same category (excluding current post)
    const relatedResult = await pool.query(
      `SELECT 
        id, title, slug, excerpt, featured_image, 
        author_name, author_role, author_avatar, 
        category, read_time_minutes, published_at
       FROM blogs
       WHERE category = $1
         AND id != $2
         AND status = 'published'
         AND published_at IS NOT NULL
         AND published_at <= CURRENT_TIMESTAMP
       ORDER BY published_at DESC
       LIMIT 3`,
      [blog.category, blog.id]
    );

    res.status(200).json({
      success: true,
      data: {
        ...blog,
        relatedPosts: relatedResult.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching blog post by slug:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve blog post.',
    });
  }
}
