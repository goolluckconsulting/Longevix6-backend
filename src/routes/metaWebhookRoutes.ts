import { Router } from 'express';
import { MetaWebhookController } from '../controllers/metaWebhookController';

const router = Router();

// GET /api/webhooks/meta (Handshake verification)
router.get('/', MetaWebhookController.handleVerification);

// POST /api/webhooks/meta (Inbound messages and events)
router.post('/', MetaWebhookController.handleInboundEvent);

export default router;
