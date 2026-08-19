import { Router } from 'express';
import pool from '../config/db';

const router = Router();

router.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    const dbRes = await pool.query('SELECT NOW()');
    if (dbRes.rows.length > 0) {
      dbStatus = 'connected';
    }
  } catch (err) {
    dbStatus = 'unreachable';
  }

  return res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: dbStatus,
    service: 'Longevix6 E-Commerce & Clinic API',
  });
});

export default router;
