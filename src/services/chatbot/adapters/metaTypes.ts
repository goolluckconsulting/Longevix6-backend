import { ChatbotChannel } from '../chatbotTypes';

export interface InboundMetaMessage {
  channel: 'whatsapp' | 'instagram';
  senderId: string;
  messageId: string;
  text?: string;
  buttonPayload?: string;
  timestamp?: string;
}

export interface MetaWebhookEntry {
  id: string;
  time?: number;
  changes?: Array<{
    field: string;
    value: {
      messaging_product?: string;
      metadata?: {
        display_phone_number?: string;
        phone_number_id?: string;
      };
      contacts?: Array<{
        profile?: { name?: string };
        wa_id?: string;
      }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        type: string;
        text?: { body: string };
        interactive?: {
          type: 'button_reply' | 'list_reply';
          button_reply?: { id: string; title: string };
          list_reply?: { id: string; title: string; description?: string };
        };
        button?: {
          payload: string;
          text: string;
        };
      }>;
      statuses?: any[];
    };
  }>;
  messaging?: Array<{
    sender: { id: string };
    recipient: { id: string };
    timestamp: number;
    message?: {
      mid: string;
      text?: string;
      quick_reply?: { payload: string };
    };
    postback?: {
      mid?: string;
      title?: string;
      payload: string;
    };
  }>;
}

export interface MetaWebhookPayload {
  object: 'whatsapp_business_account' | 'instagram' | string;
  entry: MetaWebhookEntry[];
}
