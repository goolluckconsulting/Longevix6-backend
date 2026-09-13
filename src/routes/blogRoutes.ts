import { Router } from 'express';
import { getCategories, getBlogs, getBlogBySlug } from '../controllers/blogController';

const router = Router();

// Route 1: Categories list (Static path must be registered FIRST)
router.get('/categories/list', getCategories);

// Route 2: Public blog list with query params & pagination
router.get('/', getBlogs);

// Route 3: Public blog detail by slug (Parameterized path registered LAST)
router.get('/:slug', getBlogBySlug);

export default router;
