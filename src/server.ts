import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import cookieParser from 'cookie-parser';
import orderRoutes from './routes/orderRoutes';
import paymentRoutes from './routes/paymentRoutes';
import healthRoutes from './routes/healthRoutes';
import utilRoutes from './routes/utilRoutes';
import blogRoutes from './routes/blogRoutes';
import adminRoutes from './routes/adminRoutes';
import chatbotMockRoutes from './routes/chatbotMockRoutes';
import chatbotWebRoutes from './routes/chatbotWebRoutes';
import metaWebhookRoutes from './routes/metaWebhookRoutes';

dotenv.config();

// Port & Client Configuration
const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// 1. Security & Logging Middlewares
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = [
  CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://longevix.com',
  'https://longevix6.com',
  'https://www.longevix.com',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.includes('vercel.app') ||
        origin.includes('onrender.com') ||
        origin.includes('netlify.app') ||
        origin.includes('railway.app') ||
        process.env.NODE_ENV !== 'production'
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);
app.use(morgan('dev'));
app.use(cookieParser());
app.use(
  express.json({
    limit: '512kb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// Static file serving for uploads in development mode only
if (process.env.NODE_ENV !== 'production') {
  app.use(
    '/uploads',
    (req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      next();
    },
    express.static(path.join(process.cwd(), 'uploads'))
  );
}

// 2. API Routes
app.use('/api', healthRoutes);
app.use('/api', utilRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chatbot/mock', chatbotMockRoutes);
app.use('/api/chatbot/web', chatbotWebRoutes);
app.use('/api/webhooks/meta', metaWebhookRoutes);

// Visual Interactive Chatbot Simulator Dashboard
app.get(['/simulator', '/api/chatbot/mock/simulator'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'simulator.html'));
});
app.get('/simulator.js', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'simulator.js'));
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Longevix6 Clinical Nutraceuticals API is running.',
    docs: {
      health: '/api/health',
      simulator: 'GET /simulator',
      createOrder: 'POST /api/orders/create',
      verifyPayment: 'POST /api/payments/verify',
      razorpayKey: 'GET /api/payments/key',
    },
  });
});

// 3. Global 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// 4. Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`  LONGEVIX6 BACKEND API SERVER READY     `);
  console.log(`  Port: ${PORT}                          `);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Health Check: http://localhost:${PORT}/api/health`);
  console.log(`=========================================`);
});

export default app;
