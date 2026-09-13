import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ChatbotWebController } from '../controllers/chatbotWebController';

const router = Router();

// Lightweight rate limiting: 60 requests per minute per IP for web visitors
const webChatbotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please wait a moment before sending another message.',
  },
});

// Dedicated production endpoint for website chatbot
// POST /api/chatbot/web/message
router.post('/message', webChatbotLimiter, ChatbotWebController.handleMessage);

// POST /api/chatbot/web/reset
router.post('/reset', webChatbotLimiter, ChatbotWebController.resetSession);

export default router;
