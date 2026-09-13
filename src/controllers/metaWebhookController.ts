import { Request, Response } from 'express';
import { MetaWebhookService } from '../services/chatbot/adapters/metaWebhookService';

export class MetaWebhookController {
  /**
   * GET /api/webhooks/meta
   * Handles Meta webhook verification handshake
   */
  public static handleVerification(req: Request, res: Response) {
    const mode = req.query['hub.mode'] as string | undefined;
    const verifyToken = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    const result = MetaWebhookService.verifyWebhook(mode, verifyToken, challenge);
    return res.status(result.status).send(result.body);
  }

  /**
   * POST /api/webhooks/meta
   * Handles Inbound WhatsApp and Instagram messages & interactive events
   */
  public static async handleInboundEvent(req: Request, res: Response) {
    try {
      const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

      const result = await MetaWebhookService.processWebhookPayload(
        rawBody,
        signatureHeader,
        req.body
      );

      if (!result.success && result.error === 'Invalid webhook signature') {
        return res.status(403).json({
          success: false,
          message: 'Invalid signature',
        });
      }

      // Meta expects an immediate HTTP 200 acknowledging event receipt
      return res.status(200).json({
        success: true,
        processed: result.processedCount,
      });
    } catch (error: any) {
      console.error('[MetaWebhookController] Unexpected error handling webhook event:', error);
      // Return 200 or 500 without exposing internal details
      return res.status(500).json({
        success: false,
        message: 'Internal webhook processing error',
      });
    }
  }
}
