import { InboundMetaMessage, MetaWebhookPayload } from './metaTypes';

export class MetaNormalizer {
  /**
   * Parse a raw Meta webhook payload into normalized InboundMetaMessage array
   */
  public static parseInboundEvents(payload: MetaWebhookPayload): InboundMetaMessage[] {
    const normalized: InboundMetaMessage[] = [];

    if (!payload || !Array.isArray(payload.entry)) {
      return normalized;
    }

    for (const entry of payload.entry) {
      // 1. WhatsApp Inbound Processing
      if (entry.changes && Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field === 'messages' && change.value?.messages) {
            for (const msg of change.value.messages) {
              if (!msg.from || !msg.id) continue;

              let text = '';
              let buttonPayload: string | undefined = undefined;

              if (msg.type === 'text' && msg.text?.body) {
                text = msg.text.body;
              } else if (msg.type === 'interactive' && msg.interactive) {
                if (msg.interactive.type === 'button_reply' && msg.interactive.button_reply) {
                  text = msg.interactive.button_reply.title;
                  buttonPayload = msg.interactive.button_reply.id;
                } else if (msg.interactive.type === 'list_reply' && msg.interactive.list_reply) {
                  text = msg.interactive.list_reply.title;
                  buttonPayload = msg.interactive.list_reply.id;
                }
              } else if (msg.type === 'button' && msg.button) {
                text = msg.button.text;
                buttonPayload = msg.button.payload;
              }

              normalized.push({
                channel: 'whatsapp',
                senderId: msg.from.trim(),
                messageId: msg.id,
                text,
                buttonPayload,
                timestamp: msg.timestamp,
              });
            }
          }
        }
      }

      // 2. Instagram Inbound Processing
      if (entry.messaging && Array.isArray(entry.messaging)) {
        for (const item of entry.messaging) {
          const senderId = item.sender?.id;
          if (!senderId) continue;

          // Standard Message
          if (item.message) {
            const messageId = item.message.mid || `ig_${Date.now()}_${Math.random()}`;
            const text = item.message.text || '';
            const buttonPayload = item.message.quick_reply?.payload;

            normalized.push({
              channel: 'instagram',
              senderId: senderId.trim(),
              messageId,
              text,
              buttonPayload,
              timestamp: item.timestamp ? String(item.timestamp) : undefined,
            });
          }
          // Postback (Button click)
          else if (item.postback) {
            const messageId = item.postback.mid || `ig_pb_${Date.now()}_${Math.random()}`;
            const text = item.postback.title || '';
            const buttonPayload = item.postback.payload;

            normalized.push({
              channel: 'instagram',
              senderId: senderId.trim(),
              messageId,
              text,
              buttonPayload,
              timestamp: item.timestamp ? String(item.timestamp) : undefined,
            });
          }
        }
      }
    }

    return normalized;
  }
}
