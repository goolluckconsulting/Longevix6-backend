import { Request, Response } from 'express';
import { ChatbotEngine } from '../services/chatbot/chatbotEngine';
import { LeadService } from '../services/chatbot/leadService';
import { ChatbotChannel } from '../services/chatbot/chatbotTypes';

export class ChatbotWebController {
  /**
   * POST /api/chatbot/web/message
   * Dedicated production endpoint for website chatbot widget
   */
  public static async handleMessage(req: Request, res: Response) {
    try {
      const { senderId, text = '', buttonPayload = null } = req.body;

      // 1. Strict validation of senderId (must be a valid web_<id> identifier)
      if (!senderId || typeof senderId !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Valid "senderId" is required',
        });
      }

      const trimmedSenderId = senderId.trim();
      // Enforce web_ prefix and reasonable character length
      if (!trimmedSenderId.startsWith('web_') || trimmedSenderId.length < 8 || trimmedSenderId.length > 128) {
        return res.status(400).json({
          success: false,
          message: 'Invalid senderId format. Must start with "web_" and be between 8 and 128 characters.',
        });
      }

      // 2. Validate input lengths to prevent abuse
      const sanitizedText = typeof text === 'string' ? text.slice(0, 500).trim() : '';
      const sanitizedPayload = buttonPayload ? String(buttonPayload).slice(0, 100).trim() : '';

      // 3. STRICT SECURITY: Backend FORCES channel = 'web'. Never trust client channel.
      const forcedChannel: ChatbotChannel = 'web';

      // 4. Delegate entirely to existing authoritative chatbotEngine
      const reply = await ChatbotEngine.processMessage({
        channel: forcedChannel,
        senderId: trimmedSenderId,
        text: sanitizedText,
        buttonPayload: sanitizedPayload,
      });

      // 5. If booking flow just completed on this turn, persist lead to consultation_bookings
      let leadInfo = null;
      if (reply.justCompleted && reply.session) {
        try {
          leadInfo = await LeadService.createLeadFromSession(reply.session);
        } catch (leadErr) {
          console.error('[ChatbotWebController] Error during lead creation:', leadErr);
        }
      } else if (reply.session?.id && reply.currentStep === 'completed') {
        const existingLead = await LeadService.getLeadBySessionId(reply.session.id);
        if (existingLead) {
          leadInfo = {
            created: false,
            bookingReference: existingLead.booking_reference,
            leadId: existingLead.id,
            patientName: existingLead.patient_name,
            phone: existingLead.phone,
            treatmentName: existingLead.treatment_name,
            preferredTimeSlot: existingLead.preferred_time_slot,
            status: existingLead.status,
          };
        }
      }

      // 6. Return sanitized, production-safe response payload
      return res.json({
        success: true,
        data: {
          channel: forcedChannel,
          senderId: trimmedSenderId,
          currentStep: reply.currentStep,
          text: reply.text,
          uiType: reply.uiType,
          buttons: reply.buttons || [],
          isHumanHandoff: reply.isHumanHandoff,
          session: reply.sessionData,
          lead: leadInfo,
        },
      });
    } catch (error: any) {
      console.error('[ChatbotWebController] Error processing web message:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong. Please try again.',
      });
    }
  }

  /**
   * POST /api/chatbot/web/reset
   * Resets active session for this web visitor
   */
  public static async resetSession(req: Request, res: Response) {
    try {
      const { senderId } = req.body;

      if (!senderId || typeof senderId !== 'string' || !senderId.startsWith('web_')) {
        return res.status(400).json({
          success: false,
          message: 'Valid "senderId" is required',
        });
      }

      const session = await ChatbotEngine.resetSession('web', senderId.trim());

      return res.json({
        success: true,
        message: 'Chatbot session reset successfully',
        data: {
          channel: 'web',
          senderId: session.sender_id,
          currentStep: session.current_step,
          isHumanHandoff: session.is_human_handoff,
        },
      });
    } catch (error: any) {
      console.error('[ChatbotWebController] Error resetting web session:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong. Please try again.',
      });
    }
  }
}
