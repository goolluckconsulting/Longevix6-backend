import { Router } from 'express';
import { ChatbotMockController } from '../controllers/chatbotMockController';

const router = Router();

// POST /api/chatbot/mock/message
router.post('/message', ChatbotMockController.handleMessage);

// GET /api/chatbot/mock/session/:channel/:senderId
router.get('/session/:channel/:senderId', ChatbotMockController.getSession);

// GET /api/chatbot/mock/session/:senderId (defaults to mock channel)
router.get('/session/:senderId', ChatbotMockController.getSession);

// POST /api/chatbot/mock/reset
router.post('/reset', ChatbotMockController.resetSession);

export default router;
