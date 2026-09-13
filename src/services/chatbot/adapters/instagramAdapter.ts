import { ChatbotReply } from '../chatbotTypes';

export interface InstagramSendMessagePayload {
  recipient: { id: string };
  message: {
    text: string;
    quick_replies?: Array<{
      content_type: 'text';
      title: string;
      payload: string;
    }>;
  };
}

export class InstagramAdapter {
  private static getApiConfig() {
    return {
      accessToken: process.env.META_ACCESS_TOKEN,
      apiVersion: process.env.META_GRAPH_API_VERSION || 'v20.0',
    };
  }

  /**
   * Format an internal ChatbotReply into an Instagram Send API payload
   */
  public static formatOutboundMessage(
    to: string,
    reply: ChatbotReply
  ): InstagramSendMessagePayload {
    const buttons = reply.buttons || [];

    if (buttons.length === 0) {
      return {
        recipient: { id: to },
        message: { text: reply.text },
      };
    }

    return {
      recipient: { id: to },
      message: {
        text: reply.text,
        quick_replies: buttons.slice(0, 13).map((b) => ({
          content_type: 'text',
          title: b.title.slice(0, 20),
          payload: b.id,
        })),
      },
    };
  }

  /**
   * Send Instagram message via Meta Graph API (or mock in test/dry-run mode)
   */
  public static async sendMessage(
    to: string,
    reply: ChatbotReply
  ): Promise<{ success: boolean; messageId?: string; simulated?: boolean; error?: string }> {
    const { accessToken, apiVersion } = this.getApiConfig();
    const payload = this.formatOutboundMessage(to, reply);

    if (
      !accessToken ||
      accessToken.includes('placeholder') ||
      accessToken === 'test_meta_token' ||
      process.env.NODE_ENV === 'test'
    ) {
      console.log(`[InstagramAdapter] Outbound simulated for ${to}:`, {
        text: reply.text.slice(0, 40) + '...',
        buttonsCount: reply.buttons?.length || 0,
      });
      return {
        success: true,
        simulated: true,
        messageId: `mid.sim_ig_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`,
      };
    }

    try {
      const url = `https://graph.facebook.com/${apiVersion}/me/messages`;
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
        console.error('[InstagramAdapter] Meta Graph API error:', data);
        return {
          success: false,
          error: data.error?.message || `HTTP ${res.status}`,
        };
      }

      const messageId = data.message_id;
      console.log(`[InstagramAdapter] Message dispatched to ${to}:`, messageId);
      return { success: true, messageId };
    } catch (err: any) {
      console.error('[InstagramAdapter] Network error sending Instagram message:', err);
      return { success: false, error: err.message };
    }
  }
}
