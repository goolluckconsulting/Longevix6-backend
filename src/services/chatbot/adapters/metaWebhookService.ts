import crypto from 'crypto';
import { MetaWebhookPayload } from './metaTypes';
import { MetaNormalizer } from './metaNormalizer';
import { MetaDeduplicationService } from './metaDeduplicationService';
import { WhatsAppAdapter } from './whatsappAdapter';
import { InstagramAdapter } from './instagramAdapter';
import { ChatbotEngine } from '../chatbotEngine';
import { LeadService } from '../leadService';

export class MetaWebhookService {
  /**
   * Meta Webhook Verification (GET /api/webhooks/meta)
   */
  public static verifyWebhook(
    mode?: string,
    verifyToken?: string,
    challenge?: string
  ): { status: number; body: string } {
    const configuredToken = process.env.META_VERIFY_TOKEN;

    if (!configuredToken) {
      console.warn('[MetaWebhookService] META_VERIFY_TOKEN is not configured in environment');
      return { status: 403, body: 'Verification token unconfigured' };
    }

    if (mode === 'subscribe' && verifyToken === configuredToken) {
      console.log('[MetaWebhookService] Webhook verified successfully with Meta challenge');
      return { status: 200, body: challenge || '' };
    }

    console.warn('[MetaWebhookService] Webhook verification failed (token mismatch or invalid mode)');
    return { status: 403, body: 'Forbidden: Verification token mismatch' };
  }

  /**
   * Verify HMAC-SHA256 signature from X-Hub-Signature-256 header using timing-safe comparison
   */
  public static verifySignature(
    rawBody: Buffer | string,
    signatureHeader?: string
  ): boolean {
    const appSecret = process.env.META_APP_SECRET;

    if (!appSecret) {
      console.warn('[MetaWebhookService] META_APP_SECRET is not configured in environment');
      return false;
    }

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    const signatureHash = signatureHeader.slice(7).trim();
    const hmac = crypto.createHmac('sha256', appSecret);
    const expectedHash = hmac.update(rawBody).digest('hex');

    const signatureBuffer = Buffer.from(signatureHash, 'utf8');
    const expectedBuffer = Buffer.from(expectedHash, 'utf8');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  }

  /**
   * Process Inbound Meta Webhook Payload (POST /api/webhooks/meta)
   */
  public static async processWebhookPayload(
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
    payload: MetaWebhookPayload
  ): Promise<{ success: boolean; processedCount: number; error?: string }> {
    // 1. Authenticate Meta payload via HMAC-SHA256
    const isAuthentic = this.verifySignature(rawBody, signatureHeader);
    if (!isAuthentic) {
      console.warn('[MetaWebhookService] Unauthorized payload: Invalid X-Hub-Signature-256');
      return { success: false, processedCount: 0, error: 'Invalid webhook signature' };
    }

    // 2. Normalize incoming events
    const messages = MetaNormalizer.parseInboundEvents(payload);
    if (messages.length === 0) {
      // Non-message event (e.g., status delivery receipt, read receipt) - ignore safely
      return { success: true, processedCount: 0 };
    }

    let processedCount = 0;

    for (const msg of messages) {
      // 3. Persistent DB Deduplication check
      const isDuplicate = await MetaDeduplicationService.isDuplicateAndRecord(
        msg.channel,
        msg.messageId,
        msg.senderId
      );

      if (isDuplicate) {
        continue;
      }

      try {
        // 4. Ingest into Pure FSM Engine
        const reply = await ChatbotEngine.processMessage({
          channel: msg.channel,
          senderId: msg.senderId,
          text: msg.text,
          buttonPayload: msg.buttonPayload,
        });

        // 5. Phase 4 Lead Creation if session completed
        if (reply.justCompleted && reply.session) {
          try {
            await LeadService.createLeadFromSession(reply.session);
          } catch (leadErr) {
            console.error('[MetaWebhookService] Error creating consultation lead:', leadErr);
          }
        }

        // 6. Outbound Dispatch to Meta Channel
        if (msg.channel === 'whatsapp') {
          await WhatsAppAdapter.sendMessage(msg.senderId, reply);
        } else if (msg.channel === 'instagram') {
          await InstagramAdapter.sendMessage(msg.senderId, reply);
        }

        processedCount++;
      } catch (err) {
        console.error(`[MetaWebhookService] Error processing ${msg.channel} message ${msg.messageId}:`, err);
      }
    }

    return { success: true, processedCount };
  }
}
