import { ChatbotReply } from '../chatbotTypes';

export interface WhatsAppSendMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text' | 'interactive';
  text?: { body: string };
  interactive?: {
    type: 'button' | 'list';
    header?: { type: 'text'; text: string };
    body: { text: string };
    action: any;
  };
}

export class WhatsAppAdapter {
  private static getApiConfig() {
    return {
      accessToken: process.env.META_ACCESS_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: process.env.META_GRAPH_API_VERSION || 'v20.0',
    };
  }

  /**
   * Format an internal ChatbotReply into a WhatsApp Cloud API payload
   */
  public static formatOutboundMessage(
    to: string,
    reply: ChatbotReply
  ): WhatsAppSendMessagePayload {
    const cleanTo = to.replace(/\D/g, '');
    const buttons = reply.buttons || [];

    // Case 1: Plain Text (no buttons)
    if (buttons.length === 0) {
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'text',
        text: { body: reply.text },
      };
    }

    // Case 2: Interactive Quick-Reply Buttons (1 to 3 buttons)
    if (buttons.length <= 3) {
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: reply.text },
          action: {
            buttons: buttons.map((b) => ({
              type: 'reply',
              reply: {
                id: b.id,
                title: b.title.slice(0, 20), // WhatsApp button title limit: 20 chars
              },
            })),
          },
        },
      };
    }

    // Case 3: Interactive List (> 3 buttons, e.g. Longevix6 4 main services)
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: 'Longevix6 Clinic' },
        body: { text: reply.text },
        action: {
          button: 'Select Option',
          sections: [
            {
              title: 'Options',
              rows: buttons.map((b) => ({
                id: b.id,
                title: b.title.slice(0, 24), // WhatsApp list row title limit: 24 chars
              })),
            },
          ],
        },
      },
    };
  }

  /**
   * Send WhatsApp message via Meta Graph API (or mock in test/dry-run mode)
   */
  public static async sendMessage(
    to: string,
    reply: ChatbotReply
  ): Promise<{ success: boolean; messageId?: string; simulated?: boolean; error?: string }> {
    const { accessToken, phoneNumberId, apiVersion } = this.getApiConfig();
    const payload = this.formatOutboundMessage(to, reply);

    // If credentials are not configured or are placeholders, simulate outbound safely
    if (
      !accessToken ||
      !phoneNumberId ||
      accessToken.includes('placeholder') ||
      accessToken === 'test_meta_token' ||
      process.env.NODE_ENV === 'test'
    ) {
      console.log(`[WhatsAppAdapter] Outbound simulated for ${to} (${payload.type}):`, {
        text: reply.text.slice(0, 40) + '...',
        buttonsCount: reply.buttons?.length || 0,
      });
      return {
        success: true,
        simulated: true,
        messageId: `wamid.sim_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`,
      };
    }

    try {
      const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as any;

      if (!res.ok) {
        console.error('[WhatsAppAdapter] Meta Graph API error:', data);
        return {
          success: false,
          error: data.error?.message || `HTTP ${res.status}`,
        };
      }

      const messageId = data.messages?.[0]?.id;
      console.log(`[WhatsAppAdapter] Message dispatched to ${to}:`, messageId);
      return { success: true, messageId };
    } catch (err: any) {
      console.error('[WhatsAppAdapter] Network error sending WhatsApp message:', err);
      return { success: false, error: err.message };
    }
  }
}
